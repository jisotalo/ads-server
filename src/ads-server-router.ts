/*
https://github.com/jisotalo/ads-server

Copyright (c) 2021 Jussi Isotalo <j.isotalo91@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import {
  Socket,
  SocketConnectOpts
} from 'net'

import {
  ServerCore,
  ServerException
} from './ads-server-core'

import {
  AmsRouterState,
  RouterServerSettings,
  TimerObject,
  ServerConnection
} from './types/ads-server'

import {
  AmsPortRegisteredData,
  AmsRouterStateData,
  AmsTcpPacket
} from './types/ads-types'

import * as ADS from './ads-commons'


/**
 * TwinCAT ADS server 
 * 
 * This ADS server class connects to the AMS/ADS router 
 * and listens for incoming ADS commands **(ONLY)** for the ADS port provided in settings.
 * 
 * **Requires TwinCAT installation / AMS router for operation.** Without router, see `StandAloneServer` class.
 */
export class RouterServer extends ServerCore {

  /**
   * Active settings 
   */
  public settings: RouterServerSettings = {
    routerTcpPort: 48898,
    routerAddress: 'localhost',
    localAddress: '',
    localTcpPort: 0,
    localAmsNetId: '',
    localAdsPort: 0,
    timeoutDelay: 2000,
    autoReconnect: true,
    reconnectInterval: 2000,
  }

  /**
   * Local router state (if known)
   */
  public routerState?: AmsRouterState = undefined

  /**
   * Received data buffer
   */
  private receiveBuffer = Buffer.alloc(0)

  /**
   * Socket instance
   */
  private socket?: Socket = undefined

  /**
   * Handler for socket error event
   */
  private socketErrorHandler?: (err: Error) => void
  
  /**
   * Handler for socket close event
   */
  private socketConnectionLostHandler?: (hadError: boolean) => void

  /**
   * Timer ID and handle of reconnection timer 
   */
  private reconnectionTimer: TimerObject = { id: 0 }
  
  /**
   * Timer handle for port register timeout
   */
  private portRegisterTimeoutTimer?: NodeJS.Timeout = undefined


  /**
   * Creates a new ADS server instance.
   * 
   * Settings are provided as parameter
   */
  public constructor(settings: Partial<RouterServerSettings>) {
    super(settings)

    //ServerRouter as router state callback -> set it so core can call it
    this.routerStateChangedCallback = this.onRouterStateChanged

    //Taking the default settings and then updating the provided ones
    this.settings = {
      ...this.settings,
      ...settings
    }
  }

  /**
   * Connects to the AMS router and registers ADS port.
   * Starts listening for incoming ADS commands
   * 
   * @returns {ServerConnection} Connection info
   */
  public connect(): Promise<ServerConnection> {
    return this.connectToTarget()
  }

  /**
   * Disconnects from target router and unregisters ADS port.
   * Stops listening for incoming ADS commands
   */
  public disconnect(): Promise<void> {
    return this.disconnectFromTarget()
  }

  /**
   * Reconnects to the AMS router.
   * First disconnects and then connects again.
   * 
   * @returns {ServerConnection} Connection info
   */
  public reconnect(): Promise<ServerConnection> {
    return this.reconnectToTarget()
  }

  /**
   * Connects to the AMS router and registers ADS port.
   * 
   * @param isReconnecting Not used at the moment (true = reconnecting in progress)
   */
  private connectToTarget(isReconnecting = false): Promise<ServerConnection> {
    return new Promise<ServerConnection>(async (resolve, reject) => {

      if (this.socket) {
        this.debug(`connectToTarget(): Socket already assigned`)
        return reject(new ServerException(this, 'connectToTarget()', 'Connection is already opened. Close the connection first using disconnect()'))
      }

      this.debug(`connectToTarget(): Starting to connect ${this.settings.routerAddress}:${this.settings.routerTcpPort} (reconnect: ${isReconnecting})`)

      //Creating a socket and setting it up
      const socket = new Socket()
      socket.setNoDelay(true) //Sends data without delay

      //----- Connecting error events -----
      //Listening error event during connection
      socket.once('error', (err: NodeJS.ErrnoException) => {
        this.debug('connectToTarget(): Socket connect failed: %O', err)

        //Remove all events from socket
        socket.removeAllListeners()
        this.socket = undefined

        //Reset connection flag
        this.connection.connected = false

        reject(new ServerException(this, 'connectToTarget()', `Connection to ${this.settings.routerAddress}:${this.settings.routerTcpPort} failed (socket error ${err.errno})`, err))
      })



      //Listening close event during connection
      socket.once('close', hadError => {
        this.debug(`connectToTarget(): Socket closed by remote, connection failed`)

        //Remove all events from socket
        socket.removeAllListeners()
        this.socket = undefined

        //Reset connection flag
        this.connection.connected = false

        reject(new ServerException(this, 'connectToTarget()', `Connection to ${this.settings.routerAddress}:${this.settings.routerTcpPort} failed - socket closed by remote (hadError = ${hadError})`))
      })


      //Listening end event during connection
      socket.once('end', () => {
        this.debug(`connectToTarget(): Socket connection ended by remote, connection failed.`)

        //Remove all events from socket
        socket.removeAllListeners()
        this.socket = undefined

        //Reset connection flag
        this.connection.connected = false

        if (this.settings.localAdsPort != null)
          reject(new ServerException(this, 'connectToTarget()', `Connection to ${this.settings.routerAddress}:${this.settings.routerTcpPort} failed - socket ended by remote (is the given local ADS port ${this.settings.localAdsPort} already in use?)`))
        else
          reject(new ServerException(this, 'connectToTarget()', `Connection to ${this.settings.routerAddress}:${this.settings.routerTcpPort} failed - socket ended by remote`))
      })

      //Listening timeout event during connection
      socket.once('timeout', () => {
        this.debug(`connectToTarget(): Socket timeout`)

        //No more timeout needed
        socket.setTimeout(0);
        socket.destroy()

        //Remove all events from socket
        socket.removeAllListeners()
        this.socket = undefined

        //Reset connection flag
        this.connection.connected = false

        reject(new ServerException(this, 'connectToTarget()', `Connection to ${this.settings.routerAddress}:${this.settings.routerTcpPort} failed (timeout) - No response from router in ${this.settings.timeoutDelay} ms`))
      })

      //----- Connecting error events end -----


      //Listening for connect event
      socket.once('connect', async () => {
        this.debug(`connectToTarget(): Socket connection established to ${this.settings.routerAddress}:${this.settings.routerTcpPort}`)

        //No more timeout needed
        socket.setTimeout(0);

        this.socket = socket

        //Try to register an ADS port
        try {
          const res = await this.registerAdsPort()
          const amsPortData = res.amsTcp.data as AmsPortRegisteredData

          this.connection.connected = true
          this.connection.localAmsNetId = amsPortData.localAmsNetId
          this.connection.localAdsPort = amsPortData.localAdsPort

          this.debug(`connectToTarget(): ADS port registered from router. We are ${this.connection.localAmsNetId}:${this.connection.localAdsPort}`)
        } catch (err) {

          if (socket) {
            socket.destroy()
            //Remove all events from socket
            socket.removeAllListeners()
          }

          this.socket = undefined
          this.connection.connected = false

          return reject(new ServerException(this, 'connectToTarget()', `Registering ADS port from router failed`, err))
        }

        //Remove the socket events that were used only during connectToTarget()
        socket.removeAllListeners('error')
        socket.removeAllListeners('close')
        socket.removeAllListeners('end')

        //When socket errors from now on, we will close the connection
        this.socketErrorHandler = this.onSocketError.bind(this)
        socket.on('error', this.socketErrorHandler)

        //Listening connection lost events
        this.socketConnectionLostHandler = this.onConnectionLost.bind(this, true)
        socket.on('close', this.socketConnectionLostHandler as (hadError: boolean) => void)

        //We are connected to the target
        this.emit('connect', this.connection)

        resolve(this.connection)
      })

      //Listening data event
      socket.on('data', data => {
        if (this.debugIO.enabled) {
          this.debugIO(`IO in  <------ ${data.byteLength} bytes from ${socket.remoteAddress}: ${data.toString('hex')}`)
        } else if (this.debugD.enabled) {
          this.debugD(`IO in  <------ ${data.byteLength} bytes from ${socket.remoteAddress}`)
        }

        //Adding received data to connection buffer and checking the data
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, data])

        this.handleReceivedData(
          this.receiveBuffer,
          socket,
          (newBuffer: Buffer) => this.receiveBuffer = newBuffer
        )
      })

      //Timeout only during connecting, other timeouts are handled elsewhere
      socket.setTimeout(this.settings.timeoutDelay);

      //Finally, connect
      try {
        socket.connect({
          port: this.settings.routerTcpPort,
          host: this.settings.routerAddress,
          localPort: this.settings.localTcpPort,
          localAddress: this.settings.localAddress
        } as SocketConnectOpts)

      } catch (err) {
        this.connection.connected = false

        reject(new ServerException(this, 'connectToTarget()', `Opening socket connection to ${this.settings.routerAddress}:${this.settings.routerTcpPort} failed`, err))
      }
    })
  }


/**
 * Unregisters ADS port from router (if it was registered)
 * and disconnects target system and ADS router
 *
 * @param [forceDisconnect] - If true, the connection is dropped immediately (default = false)
 * @param [isReconnecting] - If true, call is made during reconnecting
 */
  private disconnectFromTarget(forceDisconnect = false, isReconnecting = false): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {

      this.debug(`disconnectFromTarget(): Starting to close connection (force: ${forceDisconnect})`)

      try {
        if (this.socketConnectionLostHandler) {
          this.socket?.off('close', this.socketConnectionLostHandler)
        }

      } catch (err) {
        //We probably have no socket anymore. Just quit.
        forceDisconnect = true
      }

      //Clear reconnection timer only when not reconnecting
      if (!isReconnecting) {
        this.clearTimer(this.reconnectionTimer)
      }

      //Clear other timers
      if (this.portRegisterTimeoutTimer)
        clearTimeout(this.portRegisterTimeoutTimer)

      //If forced, then just destroy the socket
      if (forceDisconnect) {

      
        this.connection.connected = false
        this.connection.localAdsPort = undefined
        this.connection.localAmsNetId = ''

        this.socket?.removeAllListeners()
        this.socket?.destroy()
        this.socket = undefined

        this.emit('disconnect')

        return resolve()
      }


      try {
        await this.unregisterAdsPort()

        //Done
        this.connection.connected = false
        this.connection.localAdsPort = undefined
        this.connection.localAmsNetId = ''

        this.socket?.removeAllListeners()
        this.socket?.destroy()
        this.socket = undefined

        this.debug(`disconnectFromTarget(): Connection closed successfully`)
        this.emit('disconnect')

        return resolve()

      } catch (err) {
        //Force socket close
        this.socket?.removeAllListeners()
        this.socket?.destroy()
        this.socket = undefined

        this.connection.connected = false
        this.connection.localAdsPort = undefined
        this.connection.localAmsNetId = ''

        this.debug(`disconnectFromTarget(): Connection closing failed, connection forced to close`)
        this.emit('disconnect')
      
        return reject(new ServerException(this, 'disconnect()', `Disconnected but something failed: ${(err as Error).message}`))
      }
    })
  }



/**
 * Disconnects and reconnects again
 *
 * @param [forceDisconnect] - If true, the connection is dropped immediately (default = false)
 * @param [isReconnecting] - If true, call is made during reconnecting
 */
  private reconnectToTarget(forceDisconnect = false, isReconnecting = false): Promise<ServerConnection> {
    return new Promise<ServerConnection>(async (resolve, reject) => {

      if (this.socket) {
        try {
          this.debug(`_reconnect(): Trying to disconnect`)

          await this.disconnectFromTarget(forceDisconnect, isReconnecting)

        } catch (err) {
          //debug(`_reconnect(): Disconnecting failed: %o`, err)
        }
      }

      this.debug(`_reconnect(): Trying to connect`)

      return this.connectToTarget(true)
        .then(res => {
          this.debug(`_reconnect(): Connected!`)

          this.emit('reconnect')

          resolve(res)
        })
        .catch(err => {
          this.debug(`_reconnect(): Connecting failed`)
          reject(err)
        })
    })
  }




  /**
   * Registers a new ADS port from AMS router
   */
  private registerAdsPort(): Promise<AmsTcpPacket> {
    return new Promise<AmsTcpPacket>(async (resolve, reject) => {
      this.debugD(`registerAdsPort(): Registering an ADS port from ADS router ${this.settings.routerAddress}:${this.settings.routerTcpPort}`)

      //If a manual AmsNetId and ADS port values are used, we should resolve immediately
      //This is used for example if connecting to a remote PLC from non-ads device
      if (this.settings.localAmsNetId && this.settings.localAdsPort) {
        this.debug(`registerAdsPort(): Local AmsNetId and ADS port manually given so using ${this.settings.localAmsNetId}:${this.settings.localAdsPort}`)

        const res = {
          amsTcp: {
            data: {
              localAmsNetId: this.settings.localAmsNetId,
              localAdsPort: this.settings.localAdsPort
            }
          }
        } as AmsTcpPacket

        return resolve(res)
      }

      const packet = Buffer.alloc(8)
      let pos = 0

      //0..1 Ams command (header flag)
      packet.writeUInt16LE(ADS.AMS_HEADER_FLAG.AMS_TCP_PORT_CONNECT)
      pos += 2

      //2..5 Data length
      packet.writeUInt32LE(2, pos)
      pos += 4

      //6..7 Data: Requested ads port (0 = let the server decide)
      packet.writeUInt16LE((this.settings.localAdsPort ? this.settings.localAdsPort : 0), pos)

      //Setup callback to call when responded
      this.amsTcpCallback = (res: AmsTcpPacket) => {
        this.amsTcpCallback = undefined

        this.socket?.off('error', errorHandler)
        if (this.portRegisterTimeoutTimer)
          clearTimeout(this.portRegisterTimeoutTimer)

        this.debugD(`registerAdsPort(): ADS port registered, assigned AMS address is ${(res.amsTcp.data as AmsPortRegisteredData).localAmsNetId}:${(res.amsTcp.data as AmsPortRegisteredData).localAdsPort}`)

        resolve(res)
      }

      //Timeout (if no answer from router)
      this.portRegisterTimeoutTimer = setTimeout(() => {
        //Callback is no longer needed, delete it
        this.amsTcpCallback = undefined

        //Create a custom "ads error" so that the info is passed onwards
        const adsError = {
          ads: {
            error: true,
            errorCode: -1,
            errorStr: `Timeout - no response in ${this.settings.timeoutDelay} ms`
          }
        }
        this.debug(`registerAdsPort(): Failed to register ADS port - Timeout - no response in ${this.settings.timeoutDelay} ms`)

        return reject(new ServerException(this, 'registerAdsPort()', `Timeout - no response in ${this.settings.timeoutDelay} ms`, adsError))
      }, this.settings.timeoutDelay)

      const errorHandler = () => {
        if (this.portRegisterTimeoutTimer)
          clearTimeout(this.portRegisterTimeoutTimer)
        
        this.debugD(`registerAdsPort(): Socket connection errored.`)
        reject(new ServerException(this, 'registerAdsPort()', `Socket connection error`))
      }

      this.socket?.once('error', errorHandler)

      try {
        if (this.socket) {
          await this.socketWrite(packet, this.socket)
        } else {
          throw new ServerException(this, 'registerAdsPort()', `Error - Writing to socket failed, socket is not available`)
        }

      } catch (err) {
        this.socket?.off('error', errorHandler)
        if (this.portRegisterTimeoutTimer)
          clearTimeout(this.portRegisterTimeoutTimer)
        
        return reject(new ServerException(this, 'registerAdsPort()', `Error - Writing to socket failed`, err))
      }
    })
  }




  /**
   * Unregisters previously registered ADS port from AMS router.
   * Connection is usually also closed by remote during unregisterin.
   */
  private unregisterAdsPort(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      this.debugD(`unregisterAdsPort(): Unregister ads port ${this.connection.localAdsPort} from ${this.settings.routerAddress}:${this.settings.routerTcpPort}`)

      if (this.settings.localAmsNetId && this.settings.localAdsPort) {
        this.debug(`unregisterAdsPort(): Local AmsNetId and ADS port manually given so no need to unregister`)

        this.socket?.end(() => {
          this.debugD(`unregisterAdsPort(): Socket closed`)
          this.socket?.destroy()
          this.debugD(`unregisterAdsPort(): Socket destroyed`)
        })
        return resolve()
      }

      if (!this.socket) {
        return resolve()
      }

      const buffer = Buffer.alloc(8)
      let pos = 0

      //0..1 AMS command (header flag)
      buffer.writeUInt16LE(ADS.AMS_HEADER_FLAG.AMS_TCP_PORT_CLOSE)
      pos += 2

      //2..5 Data length
      buffer.writeUInt32LE(2, pos)
      pos += 4

      //6..9 Data: port to unregister
      buffer.writeUInt16LE(this.connection.localAdsPort as number, pos)

      this.socket.once('timeout', () => {
        this.debugD(`unregisterAdsPort(): Timeout happened during port unregister. Closing connection anyways.`)

        this.socket?.end(() => {
          this.debugD(`unregisterAdsPort(): Socket closed after timeout`)

          this.socket?.destroy()

          this.debugD(`unregisterAdsPort(): Socket destroyed after timeout`)
        })
      })

      //When socket emits close event, the ads port is unregistered and connection closed
      this.socket.once('close', (hadError: boolean) => {
        this.debugD(`unregisterAdsPort(): Ads port unregistered and socket connection closed (hadError: ${hadError}).`)
        resolve()
      })

      //Sometimes close event is not received, so resolve already here
      this.socket.once('end', () => {
        this.debugD(`unregisterAdsPort(): Socket connection ended. Connection closed.`)

        this.socket?.destroy()

        resolve()
      })

      try {
        await this.socketWrite(buffer, this.socket)
      } catch (err) {
        reject(err)
      }
    })
  }

/**
 * Event listener for socket errors
 */
  private async onSocketError(err: Error) {
    this.consoleWrite(`WARNING: Socket connection had an error, closing connection: ${JSON.stringify(err)}`)

    this.onConnectionLost(true)
  }

/**
 * Called when connection to the remote is lost
 * 
 * @param socketFailure - If true, connection was lost due socket/tcp problem -> Just destroy the socket
 * 
 */
  private async onConnectionLost(socketFailure = false) {
    this.debug(`onConnectionLost(): Connection was lost. Socket failure: ${socketFailure}`)

    this.connection.connected = false
    this.emit('connectionLost')

    if (this.settings.autoReconnect !== true) {
      this.consoleWrite.call(this, 'WARNING: Connection was lost and setting autoReconnect=false. Quiting.')
      try {
        await this.disconnectFromTarget(true)
      } catch {
        //failed
      }

      return
    }

    if (this.socketConnectionLostHandler)
      this.socket?.off('close', this.socketConnectionLostHandler)

    this.consoleWrite('WARNING: Connection was lost. Trying to reconnect...')

    const tryToReconnect = async (firstTime: boolean, timerId: number) => {

      //If the timer has changed, quit here
      if (this.reconnectionTimer.id !== timerId) {
        return
      }

      //Try to reconnect
      this.reconnectToTarget(socketFailure, true)
        .then(res => {
          this.debug(`Reconnected successfully as ${res.localAmsNetId}`)

          //Success -> remove timer
          this.clearTimer(this.reconnectionTimer)

        })
        .catch(err => {
          //Reconnecting failed
          if (firstTime) {
            this.debug(`Reconnecting failed, keeping trying in the background (${(err as Error).message}`)
            this.consoleWrite(`WARNING: Reconnecting failed. Keeping trying in the background every ${this.settings.reconnectInterval} ms...`)
          }

          //If this is still a valid timer, start over again
          if (this.reconnectionTimer.id === timerId) {
            //Creating a new timer with the same id
            this.reconnectionTimer.timer = setTimeout(
              () => tryToReconnect(false, timerId),
              this.settings.reconnectInterval
            )
          } else {
            this.debugD(`onConnectionLost(): Timer is no more valid, quiting here`)
          }
        })
    }

    //Clearing old timer if there is one + increasing timer id
    this.clearTimer(this.reconnectionTimer)

    //Starting poller timer
    this.reconnectionTimer.timer = setTimeout(
      () => tryToReconnect(true, this.reconnectionTimer.id),
      this.settings.reconnectInterval
    )
  }

  /**
   * Called when local AMS router status has changed (Router notification received)
   * For example router state changes when local TwinCAT changes from Config to Run state and vice-versa
   * 
   * @param data Packet that contains the new router state
   */
  protected onRouterStateChanged(data: AmsTcpPacket): void {
    const routerStateData = data.amsTcp.data as AmsRouterStateData

    const state = routerStateData.routerState

    this.debug(`onRouterStateChanged(): Local AMS router state has changed${(this.routerState?.stateStr ? ` from ${this.routerState?.stateStr}` : '')} to ${ADS.AMS_ROUTER_STATE.toString(state)} (${state})`)

    this.routerState = {
      state: state,
      stateStr: ADS.AMS_ROUTER_STATE.toString(state)
    }

    this.emit('routerStateChange', this.routerState)

    this.debug(`onRouterStateChanged(): Local loopback connection active, monitoring router state`)

    if (this.routerState.state === ADS.AMS_ROUTER_STATE.START) {
      this.consoleWrite(`WARNING: Local AMS router state has changed to ${ADS.AMS_ROUTER_STATE.toString(state)}. Reconnecting...`)
      this.onConnectionLost()

    } else {
      //Nothing to do, just wait until router has started again..
      this.consoleWrite(`WARNING: Local AMS router state has changed to ${ADS.AMS_ROUTER_STATE.toString(state)}. Connection might have been lost.`)
    }
  }

  /**
   * Clears given timer if it's available and increases the id
   * @param timerObject Timer object {id, timer}
   */
  private clearTimer(timerObject: TimerObject) {
    //Clearing timer
    if(timerObject.timer)
      clearTimeout(timerObject.timer)
    timerObject.timer = undefined

    //Increasing timer id
    timerObject.id = timerObject.id < Number.MAX_SAFE_INTEGER ? timerObject.id + 1 : 0;
  }
}