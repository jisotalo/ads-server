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
  Server,
  createServer,
  AddressInfo
} from 'net'

import {
  ServerCore
} from './ads-server-core'

import {
  ServerConnection,
  StandAloneServerConnection,
  StandAloneServerSettings
} from './types/ads-server'

import * as ADS from './ads-commons'


/**
 * TwinCAT ADS server
 *
 * This ADS server starts up a server at provided TCP port (default: ADS.ADS_DEFAULT_TCP_PORT = 48898).
 * 
 * Then it listens for incoming ADS commands for **any ADS port** on this AmsNetId.
 *
 * **Does not require TwinCAT installation/AMS router (for example Raspberry Pi, Linux, etc...).** 
 * With router, see `Server` class.
 */
export class StandAloneServer extends ServerCore {

  /**
   * Active settings 
   */
  public settings: StandAloneServerSettings = {
    listeningTcpPort: ADS.ADS_DEFAULT_TCP_PORT,
    localAmsNetId: ''
  }

  /**
   * Next free available connection ID
   */
  private nextConnectionid = 0

  /**
   * Object containing all active connections
   */
  private connections: Record<number, StandAloneServerConnection> = {}

  /**
   * Socket server instance
   */
  private server?: Server = undefined

  /**
   * Settings to use are provided as parameter
   */
  public constructor(settings: StandAloneServerSettings) {
    super(settings)

    //Taking the default settings and then updating the provided ones
    this.settings = {
      ...this.settings,
      ...settings
    }
  }

  /**
   * Setups a listening server and then starts listening for incoming connections
   * and ADS commands.
   */
  listen(): Promise<ServerConnection> {
    return new Promise<ServerConnection>(async (resolve, reject) => {
      try {
        this.debug(`listen(): Creating socket server`)
        this.server = createServer(this.onServerConnection.bind(this))

        //Error during startup
        const handleErrorAtStart = (err: Error) => {
          this.debug(`listen(): Creating socket server failed: ${err.message}`)
          reject(err)
        }
        this.server.on('error', handleErrorAtStart)

        //Starting to listening
        this.server.listen(
          this.settings.listeningTcpPort,
          this.settings.listeningAddress, () => {
            this.debug(`listen(): Listening on ${(this.server?.address() as AddressInfo).port}`)

            this.server?.off('error', handleErrorAtStart)
            this.server?.on('error', this.onServerError.bind(this))

            this.connection = {
              connected: true,
              localAmsNetId: this.settings.localAmsNetId
            }

            resolve(this.connection)
          })

      } catch (err) {
        this.connection.connected = false
        reject(err)
      }
    })
  }

  /**
   * Stops listening for incoming connections and closes the server.
   * If closing fails, throws an error but the server instance is destroyed anyways.
   * So the connection is always closed after calling close()
   */
  close(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      this.debug(`close(): Closing socket server`)

      this.connection.connected = false

      if (!this.server) {
        return resolve()
      }

      try {
        this.server.close(err => {
          if (err) {
            this.debug(`close(): Error during closing server but server is destroyed: ${err.message}`)
            this.server = undefined
            return reject(err)
          }

          this.server?.removeAllListeners()
          this.server = undefined
          
          resolve(err)
        })

      } catch (err) {
        reject(err)
        this.server = undefined
      }
    })
  }

  /**
   * Called when error is thrown at server instance
   * 
   * @param err Error object from this.server
   */
  private onServerError(err: Error) {
    this.debug(`onServerError(): Socket server error, disconnecting: ${err.message}`)

    this.emit("server-error", err)

    //Closing connection
    this.close()
      .catch()
  }

  /**
   * Called on a new connection at server instance
   * 
   * @param socket The new socket connection that was created
   */
  private onServerConnection(socket: Socket) {
    this.debug(`onServerConnection(): New connection from ${socket.remoteAddress}`)

    //Creating own data object for this connection
    const id = this.nextConnectionid++

    const connection: StandAloneServerConnection = {
      id,
      socket,
      buffer: Buffer.alloc(0)
    }

    //Handling incoming data
    socket.on('data', (data) => {
      if (this.debugIO.enabled) {
        this.debugIO(`IO in  <------ ${data.byteLength} bytes from ${socket.remoteAddress}: ${data.toString('hex')}`)
      } else if (this.debugD.enabled) {
        this.debugD(`IO in  <------ ${data.byteLength} bytes from ${socket.remoteAddress}`)
      }

      //Adding received data to connection buffer and checking the data
      connection.buffer = Buffer.concat([connection.buffer, data])

      this.handleReceivedData(
        connection.buffer,
        connection.socket,
        (newBuffer: Buffer) => connection.buffer = newBuffer
      )
    })

    //Handling socket closing
    socket.on("close", (hadError) => {
      this.debug(`onServerConnection(): Connection from ${socket?.remoteAddress} was closed (error: ${hadError})`)

      //Removing the connection
      socket?.removeAllListeners()
      delete this.connections[id]
    })

    socket.on("end", () => {
      this.debug(`onServerConnection(): Connection from ${socket?.remoteAddress} was ended`)

      //Removing the connection
      socket?.removeAllListeners()
      delete this.connections[id]
    })


    socket.on('error', (err) => {
      this.debug(`onServerConnection(): Connection from ${socket.remoteAddress} had error: ${err}`)
    })
    
    this.connections[id] = connection
  }
}