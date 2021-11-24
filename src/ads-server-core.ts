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
  EventEmitter
} from 'events'
import {
  Socket
} from 'net'
import Debug from 'debug'
import iconv from 'iconv-lite'

import {
  AddNotificationReq,
  AddNotificationReqCallback,
  AddNotificationReqResponse,
  AdsNotificationTarget,
  AdsRequest,
  BaseResponse,
  DeleteNotificationReq,
  DeleteNotificationReqCallback,
  GenericReqCallback,
  ReadDeviceInfoReqCallback,
  ReadDeviceInfoReqResponse,
  ReadReq,
  ReadReqCallback,
  ReadReqResponse,
  ReadStateReqCallback,
  ReadStateReqResponse,
  ReadWriteReq,
  ReadWriteReqCallback,
  ReadWriteReqResponse,
  ServerConnection,
  ServerCoreSettings,
  UnknownAdsRequest,
  WriteControlReq,
  WriteControlReqCallback,
  WriteReq,
  WriteReqCallback
} from './types/ads-server'

import {
  AdsCommandToSend,
  AmsHeader,
  AmsTcpHeader,
  AmsTcpPacket
} from './types/ads-types'

import * as ADS from './ads-commons'

/**
 * Base abstract class for ADS server 
 */
export abstract class ServerCore extends EventEmitter {

  protected debug = Debug('ads-server')
  protected debugD = Debug(`ads-server:details`)
  protected debugIO = Debug(`ads-server:raw-data`)

  /**
   * Active settings 
   */
  public settings: ServerCoreSettings = {
    localAmsNetId: '',
    hideConsoleWarnings: false,
  }

  /**
   * Active connection information
   */
  public connection: ServerConnection = {
    connected: false,
    localAmsNetId: ''
  }

  /**
   * Active debug level
   *  - 0 = no debugging
   *  - 1 = Extended exception stack trace
   *  - 2 = basic debugging (same as $env:DEBUG='ads-server')
   *  - 3 = detailed debugging (same as $env:DEBUG='ads-server,ads-server:details')
   *  - 4 = full debugging (same as $env:DEBUG='ads-server,ads-server:details,ads-server:raw-data')
   */
  public debugLevel = 0

  /**
   * Callback used for ams/tcp commands (like port register)
   */
  protected amsTcpCallback?: ((packet: AmsTcpPacket) => void)

  /**
   * Callback for AMS router state change
   * Used only with ads-server-router
   */
  protected routerStateChangedCallback?: (data: AmsTcpPacket) => void
  
  /**
   * Callbacks for ADS command requests
   */
  protected requestCallbacks: {
    [key: string]: GenericReqCallback
  } = {}
  
  /**
   * Settings to use are provided as parameter
   */
  constructor(settings: Partial<ServerCoreSettings>) {
    super()

    //Taking the default settings and then updating the provided ones
    this.settings = {
      ...this.settings,
      ...settings
    }
  }

  /**
   * Sets debugging using debug package on/off. 
   * Another way for environment variable DEBUG:
   *  - 0 = no debugging
   *  - 1 = Extended exception stack trace
   *  - 2 = basic debugging (same as $env:DEBUG='ads-server')
   *  - 3 = detailed debugging (same as $env:DEBUG='ads-server,ads-server:details')
   *  - 4 = full debugging (same as $env:DEBUG='ads-server,ads-server:details,ads-server:raw-data')
   * 
   * @param level 0 = none, 1 = extended stack traces, 2 = basic, 3 = detailed, 4 = detailed + raw data
   */
  setDebugging(level: number): void {
    this.debug(`setDebugging(): Setting debug level to ${level}`)

    this.debugLevel = level

    this.debug.enabled = level >= 2
    this.debugD.enabled = level >= 3
    this.debugIO.enabled = level >= 4

    this.debug(`setDebugging(): Debug level set to ${level}`)
  }

  /**
   * Checks received data buffer for full AMS packets. If full packet is found, it is parsed and handled.
   * Calls itself recursively if multiple packets available. Added also setImmediate calls to prevent event loop from blocking
   * 
   * @param buffer Data buffer to check
   * @param socket Socket connection to use for responding
   * @param setNewBufferCallback Callback that is called to update current data buffer contents
   */
  protected handleReceivedData(buffer: Buffer, socket: Socket, setNewBufferCallback: (newBuffer: Buffer) => void): void {
    //If we haven't enough data to determine packet size, quit
    if (buffer.byteLength < ADS.AMS_TCP_HEADER_LENGTH)
      return

    //There should be an AMS packet, so the packet size is available in the bytes 2..5
    const packetLength = buffer.readUInt32LE(2) + ADS.AMS_TCP_HEADER_LENGTH

    //Not enough data yet? quit
    if (buffer.byteLength < packetLength)
      return

    const data = Buffer.from(buffer.slice(0, packetLength))
    buffer = buffer.slice(data.byteLength)

    setNewBufferCallback(buffer)

    //Parse the packet, but allow time for the event loop
    setImmediate(this.parseAmsTcpPacket.bind(this, data, socket))

    //If there is more, call recursively but allow time for the event loop
    if (buffer.byteLength >= ADS.AMS_TCP_HEADER_LENGTH) {
      setImmediate(this.handleReceivedData.bind(this, buffer, socket, setNewBufferCallback))
    }
  }

  /**
   * Parses an AMS/TCP packet from given buffer and then handles it
   * 
   * @param data Buffer that contains data for a single full AMS/TCP packet
   * @param socket Socket connection to use for responding
   */
  protected async parseAmsTcpPacket(data: Buffer, socket: Socket): Promise<void> {
    const packet = {} as AmsTcpPacket

    //1. Parse AMS/TCP header
    const parsedAmsTcpHeader = this.parseAmsTcpHeader(data)
    packet.amsTcp = parsedAmsTcpHeader.amsTcp
    data = parsedAmsTcpHeader.data

    //2. Parse AMS header (if exists)
    const parsedAmsHeader = this.parseAmsHeader(data)
    packet.ams = parsedAmsHeader.ams
    data = parsedAmsHeader.data

    //3. Parse ADS data (if exists)
    packet.ads = (packet.ams.error ? { rawData: Buffer.alloc(0) } : this.parseAdsData(packet, data))

    //4. Handle the parsed packet
    this.onAmsTcpPacketReceived(packet, socket)
  }

  /**
   * Parses an AMS/TCP header from given buffer
   * 
   * @param data Buffer that contains data for a single full AMS/TCP packet
   * @returns Object `{amsTcp, data}`, where amsTcp is the parsed header and data is rest of the data
   */
  protected parseAmsTcpHeader(data: Buffer): { amsTcp: AmsTcpHeader, data: Buffer } {
    this.debugD(`parseAmsTcpHeader(): Starting to parse AMS/TCP header`)

    let pos = 0
    const amsTcp = {} as AmsTcpHeader

    //0..1 AMS command (header flag)
    amsTcp.command = data.readUInt16LE(pos)
    amsTcp.commandStr = ADS.AMS_HEADER_FLAG.toString(amsTcp.command)
    pos += 2

    //2..5 Data length
    amsTcp.dataLength = data.readUInt32LE(pos)
    pos += 4

    //Remove AMS/TCP header from data  
    data = data.slice(ADS.AMS_TCP_HEADER_LENGTH)

    //If data length is less than AMS_HEADER_LENGTH,
    //we know that this packet has no AMS headers -> it's only a AMS/TCP command
    if (data.byteLength < ADS.AMS_HEADER_LENGTH) {
      amsTcp.data = data

      //Remove data (basically creates an empty buffer..)
      data = data.slice(data.byteLength)
    }

    this.debugD(`parseAmsTcpHeader(): AMS/TCP header parsed: %o`, amsTcp)

    return { amsTcp, data }
  }

  /**
   * Parses an AMS header from given buffer
   * 
   * @param data Buffer that contains data for a single AMS packet (without AMS/TCP header)
   * @returns Object `{ams, data}`, where ams is the parsed AMS header and data is rest of the data
   */
  protected parseAmsHeader(data: Buffer): { ams: AmsHeader, data: Buffer } {
    this.debugD(`parseAmsHeader(): Starting to parse AMS header`)

    let pos = 0
    const ams = {} as AmsHeader

    if (data.byteLength < ADS.AMS_HEADER_LENGTH) {
      this.debugD(`parseAmsHeader(): No AMS header found`)
      return { ams, data }
    }

    //0..5 Target AMSNetId
    ams.targetAmsNetId = this.byteArrayToAmsNedIdStr(data.slice(pos, pos + ADS.AMS_NET_ID_LENGTH))
    pos += ADS.AMS_NET_ID_LENGTH

    //6..8 Target ads port
    ams.targetAdsPort = data.readUInt16LE(pos)
    pos += 2

    //8..13 Source AMSNetId
    ams.sourceAmsNetId = this.byteArrayToAmsNedIdStr(data.slice(pos, pos + ADS.AMS_NET_ID_LENGTH))
    pos += ADS.AMS_NET_ID_LENGTH

    //14..15 Source ads port
    ams.sourceAdsPort = data.readUInt16LE(pos)
    pos += 2

    //16..17 ADS command
    ams.adsCommand = data.readUInt16LE(pos)
    ams.adsCommandStr = ADS.ADS_COMMAND.toString(ams.adsCommand)
    pos += 2

    //18..19 State flags
    ams.stateFlags = data.readUInt16LE(pos)
    ams.stateFlagsStr = ADS.ADS_STATE_FLAGS.toString(ams.stateFlags)
    pos += 2

    //20..23 Data length
    ams.dataLength = data.readUInt32LE(pos)
    pos += 4

    //24..27 Error code
    ams.errorCode = data.readUInt32LE(pos)
    pos += 4

    //28..31 Invoke ID
    ams.invokeId = data.readUInt32LE(pos)
    pos += 4

    //Remove AMS header from data  
    data = data.slice(ADS.AMS_HEADER_LENGTH)

    //ADS error
    ams.error = (ams.errorCode !== null ? ams.errorCode > 0 : false)
    ams.errorStr = ''
    if (ams.error) {
      ams.errorStr = ADS.ADS_ERROR[ams.errorCode as keyof typeof ADS.ADS_ERROR]
    }

    this.debugD(`parseAmsHeader(): AMS header parsed: %o`, ams)

    return { ams, data }
  }

  /**
   * Parses ADS data from given buffer. Uses `packet.ams` to determine the ADS command.
   * 
   * @param data Buffer that contains data for a single ADS packet (without AMS/TCP header and AMS header)
   * @returns Object that contains the parsed ADS data
   */
  protected parseAdsData(packet: AmsTcpPacket, data: Buffer): AdsRequest {
    this.debugD(`parseAdsData(): Starting to parse ADS data`)

    let pos = 0

    if (data.byteLength === 0) {
      this.debugD(`parseAdsData(): No ADS data found`)
      return {
        //TODO
      } as AdsRequest
    }

    let ads

    switch (packet.ams.adsCommand) {
      //-------------- Read Write ---------------
      case ADS.ADS_COMMAND.ReadWrite:
        ads = {} as ReadWriteReq

        //0..3
        ads.indexGroup = data.readUInt32LE(pos)
        pos += 4

        //4..7
        ads.indexOffset = data.readUInt32LE(pos)
        pos += 4

        //8..11
        ads.readLength = data.readUInt32LE(pos)
        pos += 4

        //8..9 
        ads.writeLength = data.readUInt32LE(pos)
        pos += 4

        //..n Data
        ads.data = Buffer.alloc(ads.writeLength)
        data.copy(ads.data, 0, pos)

        break



      case ADS.ADS_COMMAND.Read:
        ads = {} as ReadReq

        //0..3
        ads.indexGroup = data.readUInt32LE(pos)
        pos += 4

        //4..7
        ads.indexOffset = data.readUInt32LE(pos)
        pos += 4

        //8..11
        ads.readLength = data.readUInt32LE(pos)
        pos += 4
        break


      //-------------- Write ---------------
      case ADS.ADS_COMMAND.Write:
        ads = {} as WriteReq

        //0..3
        ads.indexGroup = data.readUInt32LE(pos)
        pos += 4

        //4..7
        ads.indexOffset = data.readUInt32LE(pos)
        pos += 4

        //8..9 
        ads.writeLength = data.readUInt32LE(pos)
        pos += 4

        //..n Data
        ads.data = Buffer.alloc(ads.writeLength)
        data.copy(ads.data, 0, pos)
        break



      //-------------- Device info ---------------
      case ADS.ADS_COMMAND.ReadDeviceInfo:
        //No request payload
        ads = {}

        break





      //-------------- Device status ---------------
      case ADS.ADS_COMMAND.ReadState:
        //No request payload
        ads = {}

        break




      //-------------- Add notification ---------------
      case ADS.ADS_COMMAND.AddNotification:
        ads = {} as AddNotificationReq

        //0..3 IndexGroup
        ads.indexGroup = data.readUInt32LE(pos)
        pos += 4

        //4..7 IndexOffset
        ads.indexOffset = data.readUInt32LE(pos)
        pos += 4

        //8..11 Data length
        ads.dataLength = data.readUInt32LE(pos)
        pos += 4

        //12..15 Transmission mode
        ads.transmissionMode = data.readUInt32LE(pos)
        ads.transmissionModeStr = ADS.ADS_TRANS_MODE.toString(ads.transmissionMode)
        pos += 4

        //16..19 Maximum delay (ms) - When subscribing, a notification is sent after this time even if no changes 
        ads.maximumDelay = data.readUInt32LE(pos) / 10000
        pos += 4

        //20..23 Cycle time (ms) - How often the PLC checks for value changes (minimum value: Task 0 cycle time)
        ads.cycleTime = data.readUInt32LE(pos) / 10000
        pos += 4

        //24..40 reserved
        ads.reserved = data.slice(pos)

        break




      //-------------- Delete notification ---------------
      case ADS.ADS_COMMAND.DeleteNotification:
        ads = {} as DeleteNotificationReq

        //0..3 Notification handle
        ads.notificationHandle = data.readUInt32LE(pos)
        pos += 4

        break



      //-------------- Notification ---------------
      case ADS.ADS_COMMAND.Notification:

        //Server shouldn't receive this

        break



      //-------------- WriteControl ---------------
      case ADS.ADS_COMMAND.WriteControl: {
        ads = {} as WriteControlReq

        //0..1 ADS state
        ads.adsState = data.readUInt16LE(pos)
        ads.adsStateStr = ADS.ADS_STATE.toString(ads.adsState)
        pos += 2

        //2..3 Device state
        ads.deviceState = data.readUInt16LE(pos)
        pos += 2

        //4..7 Data length
        const dataLen = data.readUInt32LE(pos)
        pos += 4

        //7..n Data
        ads.data = Buffer.alloc(dataLen)
        data.copy(ads.data, 0, pos)

        break
      }
    }

    this.debugD(`parseAdsData(): ADS data parsed: %o`, ads)

    if (ads) {
      return ads
    }
    
    this.debug(`parseAdsData(): Unknown ads command received: ${packet.ams.adsCommand}`)
    return {
      error: true,
      errorStr: `Unknown ADS command for parser: ${packet.ams.adsCommand} (${packet.ams.adsCommandStr})`,
      errorCode: -1
    } as UnknownAdsRequest
    
  }
  
  /**
   * Handles the parsed AMS/TCP packet and actions/callbacks etc. related to it.
   * 
   * @param packet Fully parsed AMS/TCP packet, includes AMS/TCP header and if available, also AMS header and ADS data
   */
  protected onAmsTcpPacketReceived(packet: AmsTcpPacket, socket: Socket): void {
    this.debugD(`onAmsTcpPacketReceived(): A parsed AMS packet received with command ${packet.amsTcp.command}`)

    switch (packet.amsTcp.command) {
      //-------------- ADS command ---------------
      case ADS.AMS_HEADER_FLAG.AMS_TCP_PORT_AMS_CMD:
        packet.amsTcp.commandStr = 'Ads command'

        if (packet.ams.targetAmsNetId === this.connection.localAmsNetId
          || packet.ams.targetAmsNetId === ADS.LOOPBACK_AMS_NET_ID) {
          
          this.onAdsCommandReceived(packet, socket)
        } else {
          this.debug(`Received ADS command but it's not for us (target: ${packet.ams.targetAmsNetId}:${packet.ams.targetAdsPort})`)
        }

        break

      //-------------- AMS/TCP port unregister ---------------
      case ADS.AMS_HEADER_FLAG.AMS_TCP_PORT_CLOSE:
        packet.amsTcp.commandStr = 'Port unregister'
        //TODO: No action at the moment
        break

      //-------------- AMS/TCP port register ---------------
      case ADS.AMS_HEADER_FLAG.AMS_TCP_PORT_CONNECT:
        packet.amsTcp.commandStr = 'Port register'

        //Parse data
        if (packet.amsTcp.data instanceof Buffer) {
          const data = packet.amsTcp.data as Buffer

          packet.amsTcp.data = {
            //0..5 Own AmsNetId
            localAmsNetId: this.byteArrayToAmsNedIdStr(data.slice(0, ADS.AMS_NET_ID_LENGTH)),
            //5..6 Own assigned ADS port
            localAdsPort: data.readUInt16LE(ADS.AMS_NET_ID_LENGTH)
          }

          if (this.amsTcpCallback) {
            this.amsTcpCallback(packet)
          } else {
            this.debugD(`onAmsTcpPacketReceived(): Port register response received but no callback was assigned (${packet.amsTcp.commandStr})`)
          }
        } else {
          this.debugD(`onAmsTcpPacketReceived(): amsTcp data is unknown type`)
        }
        break

      //-------------- AMS router note ---------------
      case ADS.AMS_HEADER_FLAG.AMS_TCP_PORT_ROUTER_NOTE:
        packet.amsTcp.commandStr = 'Port router note'

        //Parse data
        if (packet.amsTcp.data instanceof Buffer) {
          const data = packet.amsTcp.data as Buffer

          packet.amsTcp.data = {
            //0..3 Router state
            routerState: data.readUInt32LE(0)
          }
          
          if (this.routerStateChangedCallback) {
            this.routerStateChangedCallback(packet)
          }

        } else {
          this.debugD(`onAmsTcpPacketReceived(): amsTcp data is unknown type`)
        }
        break

      //-------------- Get local ams net id response ---------------
      case ADS.AMS_HEADER_FLAG.GET_LOCAL_NETID:
        packet.amsTcp.commandStr = 'Get local net id'
        //TODO: No action at the moment
        break

      default:
        packet.amsTcp.commandStr = `Unknown AMS/TCP command ${packet.amsTcp.command}`
        this.debug(`onAmsTcpPacketReceived(): Unknown AMS/TCP command received: "${packet.amsTcp.command}" - Doing nothing`)
        //TODO: No action at the moment
        break
    }
  }

  /**
   * Handles received ADS command
   * 
   * @param packet Fully parsed AMS/TCP packet, includes AMS/TCP header, AMS header and ADS data
   * @param socket Socket connection to use for responding
   */
  protected onAdsCommandReceived(packet: AmsTcpPacket, socket: Socket): void {
    this.debugD(`onAdsCommandReceived(): A parsed ADS command received with command ${packet.ams.adsCommand}`)

    //Get callback by ads command
    const callback = this.requestCallbacks[packet.ams.adsCommandStr]

    if (!callback) {
      //Command received but no callback
      this.consoleWrite(`NOTE: ${packet.ams.adsCommandStr} request received from ${packet.ams.sourceAmsNetId}:${packet.ams.sourceAdsPort} to ADS port ${packet.ams.targetAdsPort} but no callback assigned`)
      return;
    }

    switch (packet.ams.adsCommand) {
      //ReadWrite and Read requests
      case ADS.ADS_COMMAND.ReadWrite:
      case ADS.ADS_COMMAND.Read:

        callback(
          packet.ads,
          async (response: (ReadReqResponse | ReadWriteReqResponse) = {}) => {

            let buffer = null, pos = 0

            if (response.data != null && Buffer.isBuffer(response.data)) {
              buffer = Buffer.alloc(8 + response.data.byteLength)

              //0..3 ADS error
              buffer.writeUInt32LE(response.error != null ? response.error : 0, pos)
              pos += 4

              //4..7 Data length
              buffer.writeUInt32LE(response.data.byteLength, pos)
              pos += 4

              //8..n Data
              response.data.copy(buffer, pos)

            }
            else {
              buffer = Buffer.alloc(8)

              //0..3 ADS error
              buffer.writeUInt32LE(response.error != null ? response.error : 0, pos)
              pos += 4

              //4..7 Data length
              buffer.writeUInt32LE(0, pos)
              pos += 4
            }


            //Sending the response
            await this.sendAdsCommand({
              adsCommand: packet.ams.adsCommand,
              targetAmsNetId: packet.ams.sourceAmsNetId,
              targetAdsPort: packet.ams.sourceAdsPort,
              sourceAmsNetId: packet.ams.targetAmsNetId,
              sourceAdsPort: packet.ams.targetAdsPort,
              invokeId: packet.ams.invokeId,
              rawData: buffer
            }, socket)
          },
          packet,
          packet.ams.targetAdsPort
        )

        break
      
      //Write request
      case ADS.ADS_COMMAND.Write:

        callback(
          packet.ads,
          async (response: ReadWriteReqResponse = {}) => {

            const buffer = Buffer.alloc(4)

            //0..3 ADS error
            buffer.writeUInt32LE(response !== undefined && response.error != null ? response.error : 0, 0)

            //Sending the response
            await this.sendAdsCommand({
              adsCommand: packet.ams.adsCommand,
              targetAmsNetId: packet.ams.sourceAmsNetId,
              targetAdsPort: packet.ams.sourceAdsPort,
              sourceAmsNetId: packet.ams.targetAmsNetId,
              sourceAdsPort: packet.ams.targetAdsPort,
              invokeId: packet.ams.invokeId,
              rawData: buffer
            }, socket)
          },
          packet,
          packet.ams.targetAdsPort
        )

        break
      
      //Device info request
      case ADS.ADS_COMMAND.ReadDeviceInfo:

        callback(
          packet.ads,
          async (response: ReadDeviceInfoReqResponse = {}) => {

            const buffer = Buffer.alloc(24)
            let pos = 0

            //0..3 ADS error
            buffer.writeUInt32LE(response.error != null ? response.error : 0, pos)
            pos += 4

            //4 Major version
            buffer.writeUInt8(response.majorVersion != null ? response.majorVersion : 0, pos)
            pos += 1

            //5 Minor version
            buffer.writeUInt8(response.minorVersion != null ? response.minorVersion : 0, pos)
            pos += 1

            //6..7 Version build
            buffer.writeUInt16LE(response.versionBuild != null ? response.versionBuild : 0, pos)
            pos += 2

            //8..24 Device name
            iconv.encode(response.deviceName != null ? response.deviceName : '', 'cp1252').copy(buffer, pos)

            //Sending the response
            await this.sendAdsCommand({
              adsCommand: packet.ams.adsCommand,
              targetAmsNetId: packet.ams.sourceAmsNetId,
              targetAdsPort: packet.ams.sourceAdsPort,
              sourceAmsNetId: packet.ams.targetAmsNetId,
              sourceAdsPort: packet.ams.targetAdsPort,
              invokeId: packet.ams.invokeId,
              rawData: buffer
            }, socket)
          },
          packet,
          packet.ams.targetAdsPort
        )

        break
      
      //Read state request
      case ADS.ADS_COMMAND.ReadState:

        callback(
          packet.ads,
          async (response: ReadStateReqResponse = {}) => {

            const buffer = Buffer.alloc(8)
            let pos = 0

            //0..3 ADS error
            buffer.writeUInt32LE(response.error != null ? response.error : 0, pos)
            pos += 4

            //4..5 ADS state (ADS.ADS_STATE.Invalid = 0)
            buffer.writeUInt16LE(response.adsState != null ? response.adsState : ADS.ADS_STATE.Invalid, pos)
            pos += 2

            //6..7 Device state
            buffer.writeUInt16LE(response.deviceState != null ? response.deviceState : 0, pos)
            pos += 2

            //Sending the response
            await this.sendAdsCommand({
              adsCommand: packet.ams.adsCommand,
              targetAmsNetId: packet.ams.sourceAmsNetId,
              targetAdsPort: packet.ams.sourceAdsPort,
              sourceAmsNetId: packet.ams.targetAmsNetId,
              sourceAdsPort: packet.ams.targetAdsPort,
              invokeId: packet.ams.invokeId,
              rawData: buffer
            }, socket)
          },
          packet,
          packet.ams.targetAdsPort
        )

        break
      
      //Add notification request
      case ADS.ADS_COMMAND.AddNotification:

        //Let's add a helper object for sending notifications
        packet.ads.notificationTarget = {
          targetAmsNetId: packet.ams.targetAmsNetId,
          targetAdsPort: packet.ams.sourceAdsPort
        } as AdsNotificationTarget

        callback(
          packet.ads,
          async (response: AddNotificationReqResponse = {}) => {

            const buffer = Buffer.alloc(8)
            let pos = 0

            //0..3 ADS error
            buffer.writeUInt32LE(response.error != null ? response.error : 0, pos)
            pos += 4

            //4..7 Notification handle
            buffer.writeUInt32LE(response.notificationHandle != null ? response.notificationHandle : 0, pos)
            pos += 2

            //Sending the response
            await this.sendAdsCommand({
              adsCommand: packet.ams.adsCommand,
              targetAmsNetId: packet.ams.sourceAmsNetId,
              targetAdsPort: packet.ams.sourceAdsPort,
              sourceAmsNetId: packet.ams.targetAmsNetId,
              sourceAdsPort: packet.ams.targetAdsPort,
              invokeId: packet.ams.invokeId,
              rawData: buffer
            }, socket)
          },
          packet,
          packet.ams.targetAdsPort
        )
        break
      
      //Delete notification request
      case ADS.ADS_COMMAND.DeleteNotification:

        callback(
          packet.ads,
          async (response: BaseResponse = {}) => {

            const buffer = Buffer.alloc(4)
            let pos = 0

            //0..3 ADS error
            buffer.writeUInt32LE(response.error != null ? response.error : 0, pos)
            pos += 4

            //Sending the response
            await this.sendAdsCommand({
              adsCommand: packet.ams.adsCommand,
              targetAmsNetId: packet.ams.sourceAmsNetId,
              targetAdsPort: packet.ams.sourceAdsPort,
              sourceAmsNetId: packet.ams.targetAmsNetId,
              sourceAdsPort: packet.ams.targetAdsPort,
              invokeId: packet.ams.invokeId,
              rawData: buffer
            }, socket)
          },
          packet,
          packet.ams.targetAdsPort
        )
        break
      
      //Notification received
      case ADS.ADS_COMMAND.Notification:

        //No need for this at the moment?
        break
      
      //WriteControl request
      case ADS.ADS_COMMAND.WriteControl:

        callback(
          packet.ads,
          async (response: BaseResponse) => {

            const buffer = Buffer.alloc(4)

            //0..3 ADS error
            buffer.writeUInt32LE(response.error ? response.error : 0, 0)

            //Sending the response
            await this.sendAdsCommand({
              adsCommand: packet.ams.adsCommand,
              targetAmsNetId: packet.ams.sourceAmsNetId,
              targetAdsPort: packet.ams.sourceAdsPort,
              sourceAmsNetId: packet.ams.targetAmsNetId,
              sourceAdsPort: packet.ams.targetAdsPort,
              invokeId: packet.ams.invokeId,
              rawData: buffer
            }, socket)
          },
          packet,
          packet.ams.targetAdsPort
        )

        break

      default:
        //Unknown command
        this.debug(`onAdsCommandReceived: Unknown ads command: ${packet.ams.adsCommand}`)
        this.consoleWrite(`WARNING: Unknown ADS command ${packet.ams.adsCommand} received from ${packet.ams.sourceAmsNetId}:${packet.ams.sourceAdsPort} to ADS port ${packet.ams.targetAdsPort}`)
        break
    }
  }
  
  /**
   * 
   * @param data ADS command to send
   * @param socket Socket connection to use for responding
   */
  protected sendAdsCommand(data: AdsCommandToSend, socket: Socket): Promise<void> {
    return new Promise<void>(async (resolve, reject): Promise<void> => {

      //Creating the data packet object
      const packet: AmsTcpPacket = {
        amsTcp: {
          command: ADS.AMS_HEADER_FLAG.AMS_TCP_PORT_AMS_CMD,
          commandStr: ADS.AMS_HEADER_FLAG.toString(ADS.AMS_HEADER_FLAG.AMS_TCP_PORT_AMS_CMD),
          dataLength: 0,
          data: null
        },
        ams: {
          targetAmsNetId: data.targetAmsNetId,
          targetAdsPort: data.targetAdsPort,
          sourceAmsNetId: data.sourceAmsNetId,
          sourceAdsPort: data.sourceAdsPort,
          adsCommand: data.adsCommand,
          adsCommandStr: ADS.ADS_COMMAND.toString(data.adsCommand),
          stateFlags: ADS.ADS_STATE_FLAGS.Response | ADS.ADS_STATE_FLAGS.AdsCommand,
          stateFlagsStr: '',
          dataLength: data.rawData.byteLength,
          errorCode: 0,
          invokeId: data.invokeId,
          error: false,
          errorStr: ''
        },
        ads: {
          rawData: data.rawData
        }
      }
      packet.ams.stateFlagsStr = ADS.ADS_STATE_FLAGS.toString(packet.ams.stateFlags)

      this.debugD(`sendAdsCommand(): Sending an ads command ${packet.ams.adsCommandStr} (${data.rawData.byteLength} bytes): %o`, packet)

      //Creating a full AMS/TCP request
      let request = {} as Buffer

      try {
        request = this.createAmsTcpRequest(packet)
      } catch (err) {
        return reject(new ServerException(this, 'sendAdsCommand()', err as Error))
      }

      //Write the data 
      try {
        this.socketWrite(request, socket)
        return resolve()
      } catch (err) {
        return reject(new ServerException(this, 'sendAdsCommand()', `Error - Socket is not available`, err as Error))
      }
    })
  }

  /**
   * Creates an AMS/TCP request from given packet
   * 
   * @param packet Object containing the full AMS/TCP packet
   * @returns Full created AMS/TCP request as buffer
   */
  protected createAmsTcpRequest(packet: AmsTcpPacket): Buffer {
    //1. Create ADS data
    const adsData = packet.ads.rawData

    //2. Create AMS header
    const amsHeader = this.createAmsHeader(packet)

    //3. Create AMS/TCP header
    const amsTcpHeader = this.createAmsTcpHeader(packet, amsHeader)

    //4. Create full AMS/TCP packet
    const amsTcpRequest = Buffer.concat([amsTcpHeader, amsHeader, adsData ? adsData : Buffer.alloc(0)])

    this.debugD(`createAmsTcpRequest(): AMS/TCP request created (${amsTcpRequest.byteLength} bytes)`)

    return amsTcpRequest
  }

  /**
   * Creates an AMS header from given packet
   * 
   * @param packet Object containing the full AMS/TCP packet
   * @returns Created AMS header as buffer
   */
  protected createAmsHeader(packet: AmsTcpPacket): Buffer {
    //Allocating bytes for AMS header
    const header = Buffer.alloc(ADS.AMS_HEADER_LENGTH)
    let pos = 0

    //0..5 Target AMSNetId
    Buffer.from(this.amsNetIdStrToByteArray(packet.ams.targetAmsNetId)).copy(header, 0)
    pos += ADS.AMS_NET_ID_LENGTH

    //6..8 Target ads port
    header.writeUInt16LE(packet.ams.targetAdsPort, pos)
    pos += 2

    //8..13 Source ads port
    Buffer.from(this.amsNetIdStrToByteArray(packet.ams.sourceAmsNetId)).copy(header, pos)
    pos += ADS.AMS_NET_ID_LENGTH

    //14..15 Source ads port
    header.writeUInt16LE(packet.ams.sourceAdsPort, pos)
    pos += 2

    //16..17 ADS command
    header.writeUInt16LE(packet.ams.adsCommand, pos)
    pos += 2

    //18..19 State flags
    header.writeUInt16LE(packet.ams.stateFlags, pos)
    pos += 2

    //20..23 Data length
    header.writeUInt32LE(packet.ams.dataLength, pos)
    pos += 4

    //24..27 Error code
    header.writeUInt32LE(packet.ams.errorCode, pos)
    pos += 4

    //28..31 Invoke ID
    header.writeUInt32LE(packet.ams.invokeId, pos)
    pos += 4

    this.debugD(`createAmsHeader(): AMS header created (${header.byteLength} bytes)`)

    if (this.debugIO.enabled) {
      this.debugIO(`createAmsHeader(): AMS header created: %o`, header.toString('hex'))
    }

    return header
  }

  /**
   * Creates an AMS/TCP header from given packet and AMS header
   * 
   * @param packet Object containing the full AMS/TCP packet
   * @param amsHeader Buffer containing the previously created AMS header
   * @returns Created AMS/TCP header as buffer
   */
  protected createAmsTcpHeader(packet: AmsTcpPacket, amsHeader: Buffer): Buffer {
    //Allocating bytes for AMS/TCP header
    const header = Buffer.alloc(ADS.AMS_TCP_HEADER_LENGTH)
    let pos = 0

    //0..1 AMS command (header flag)
    header.writeUInt16LE(packet.amsTcp.command, pos)
    pos += 2

    //2..5 Data length
    header.writeUInt32LE(amsHeader.byteLength + packet.ams.dataLength, pos)
    pos += 4

    this.debugD(`_createAmsTcpHeader(): AMS/TCP header created (${header.byteLength} bytes)`)

    if (this.debugIO.enabled) {
      this.debugIO(`_createAmsTcpHeader(): AMS/TCP header created: %o`, header.toString('hex'))
    }

    return header
  }

  /**
   * Sets request callback for given ADS command
   * 
   * @param request ADS command as number
   * @param callback Callback function
   */
  protected setRequestCallback(request: number, callback: GenericReqCallback): void {
    //Allowing null so a callback can be removed
    if (typeof callback !== 'function' && callback != null) {
      throw new TypeError(`Given callback was not a function, it was ${typeof callback} instead`)
    }

    this.requestCallbacks[ADS.ADS_COMMAND.toString(request)] = callback
  }

  /**
   * Writes given message to console if `settings.hideConsoleWarnings` is false
   * 
   * @param str String to write to console
   */
  protected consoleWrite(str: string): void {
    if (this.settings.hideConsoleWarnings !== true)
      console.log(`ads-server: ${str}`)
  }

  /**
   * Sets callback function to be called when ADS Read request is received
   * 
   * @param callback Callback that is called when request received
   * ```js
   *  onReadReq(async (req, res) => {
   *    //do something with req object and then respond
   *    await res({..})
   *  })
   * ```
   */
  onReadReq(callback: ReadReqCallback): void {
    this.setRequestCallback(ADS.ADS_COMMAND.Read, callback)
  }

  /**
   * Sets callback function to be called when ADS ReadWrite request is received
   *
   * @param callback Callback that is called when request received
   * ```js
   *  onReadWriteReq(async (req, res) => {
   *    //do something with req object and then respond
   *    await res({..})
   *  })
   * ```
   */
  onReadWriteReq(callback: ReadWriteReqCallback): void {
    this.setRequestCallback(ADS.ADS_COMMAND.ReadWrite, callback)
  }

  /**
   * Sets callback function to be called when ADS Write request is received
   *
   * @param callback Callback that is called when request received
   * ```js
   *  onWriteReq(async (req, res) => {
   *    //do something with req object and then respond
   *    await res({..})
   *  })
   * ```
   */
  onWriteReq(callback: WriteReqCallback): void {
    this.setRequestCallback(ADS.ADS_COMMAND.Write, callback)
  }

  /**
   * Sets callback function to be called when ADS ReadDeviceInfo request is received
   *
   * @param callback Callback that is called when request received
   * ```js
   *  onReadDeviceInfo(async (req, res) => {
   *    //do something with req object and then respond
   *    await res({..})
   *  })
   * ```
   */
  onReadDeviceInfo(callback: ReadDeviceInfoReqCallback): void {
    this.setRequestCallback(ADS.ADS_COMMAND.ReadDeviceInfo, callback)
  }

  /**
   * Sets callback function to be called when ADS ReadState request is received
   *
   * @param callback Callback that is called when request received
   * ```js
   *  onReadState(async (req, res) => {
   *    //do something with req object and then respond
   *    await res({..})
   *  })
   * ```
   */
  onReadState(callback: ReadStateReqCallback): void {
    this.setRequestCallback(ADS.ADS_COMMAND.ReadState, callback)
  }

  /**
   * Sets callback function to be called when ADS AddNotification request is received
   *
   * @param callback Callback that is called when request received
   * ```js
   *  onAddNotification(async (req, res) => {
   *    //do something with req object and then respond
   *    await res({..})
   *  })
   * ```
   */
  onAddNotification(callback: AddNotificationReqCallback): void {
    this.setRequestCallback(ADS.ADS_COMMAND.AddNotification, callback)
  }

  /**
   * Sets callback function to be called when ADS DeleteNotification request is received
   *
   * @param callback Callback that is called when request received
   * ```js
   *  onDeleteNotification(async (req, res) => {
   *    //do something with req object and then respond
   *    await res({..})
   *  })
   * ```
   */
  onDeleteNotification(callback: DeleteNotificationReqCallback): void {
    this.setRequestCallback(ADS.ADS_COMMAND.DeleteNotification, callback)
  }

  /**
   * Sets callback function to be called when ADS WriteControl request is received
   *
   * @param callback Callback that is called when request received
   * ```js
   *  onWriteControl(async (req, res) => {
   *    //do something with req object and then respond
   *    await res({..})
   *  })
   * ```
   */
  onWriteControl(callback: WriteControlReqCallback): void {
    this.setRequestCallback(ADS.ADS_COMMAND.WriteControl, callback)
  }

  /**
   * Writes data to the socket
   * 
   * @param data Data to write
   * @param socket Socket to write to
   */
  protected socketWrite(data: Buffer, socket: Socket): void {
    if (this.debugIO.enabled) {
      this.debugIO(`IO out ------> ${data.byteLength} bytes : ${data.toString('hex')}`)
    } else {
      this.debugD(`IO out ------> ${data.byteLength} bytes`)
    }

    socket.write(data)
  }

  /**
   * Converts array of bytes (or Buffer) to AmsNetId string
   * 
   * @param byteArray 
   * @returns AmsNetId as string (like 192.168.1.10.1.1)
   */
  protected byteArrayToAmsNedIdStr(byteArray: Buffer | number[]): string {
    return byteArray.join('.')
  }

  /**
   * Converts AmsNetId string to array of bytes
   * 
   * @param str AmsNetId as string
   * @returns AmsNetId as array of bytes
   */
  protected amsNetIdStrToByteArray(str: string): number[] {
    return str.split('.').map(x => parseInt(x))
  }
}



/**
 * Own exception class used for Server errors
 * 
 * Derived from Error but added innerException and ADS error information
 * 
 */
export class ServerException extends Error {
  sender: string
  adsError: boolean
  adsErrorInfo: Record<string, unknown> | null = null
  metaData: unknown | null = null
  errorTrace: Array<string> = []
  getInnerException: () => (Error | ServerException | null)
  stack: string | undefined

  constructor(server: ServerCore, sender: string, messageOrError: string | Error | ServerException, ...errData: unknown[]) {

    //The 2nd parameter can be either message or another Error or ServerException
    super((messageOrError as Error).message ? (messageOrError as Error).message : messageOrError as string)

    if (messageOrError instanceof ServerException) {
      //Add to errData, so will be handled later
      errData.push(messageOrError)

    } else if (messageOrError instanceof Error) {
      //Add to errData, so will be handled later
      errData.push(messageOrError)
    }

    //Stack trace
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor)
    } else {
      this.stack = (new Error(this.message)).stack
    }

    this.name = this.constructor.name
    this.sender = sender
    this.adsError = false
    this.adsErrorInfo = null
    this.metaData = null
    this.errorTrace = []
    this.getInnerException = () => null


    //Loop through given additional data
    errData.forEach(data => {

      if (data instanceof ServerException && this.getInnerException == null) {
        //Another ServerException error
        this.getInnerException = () => data

        //Add it to our own tracing array
        this.errorTrace.push(`${(this.getInnerException() as ServerException).sender}: ${this.getInnerException()?.message}`);

        //Add also all traces from the inner exception
        (this.getInnerException() as ServerException).errorTrace.forEach((s: string) => this.errorTrace.push(s))

        //Modifying the stack trace so it contains all previous ones too
        //Source: Matt @ https://stackoverflow.com/a/42755876/8140625

        if (server.debugLevel > 0) {
          const message_lines = (this.message.match(/\n/g) || []).length + 1
          this.stack = this.stack ? this.stack.split('\n').slice(0, message_lines + 1).join('\n') + '\n' : "" +
            this.getInnerException()?.stack
        }

      } else if (data instanceof Error && this.getInnerException == null) {

        //Error -> Add it's message to our message
        this.message += ` (${data.message})`
        this.getInnerException = () => data

        //Modifying the stack trace so it contains all previous ones too
        //Source: Matt @ https://stackoverflow.com/a/42755876/8140625
        if (server.debugLevel > 0) {
          const message_lines = (this.message.match(/\n/g) || []).length + 1
          this.stack = this.stack ? this.stack.split('\n').slice(0, message_lines + 1).join('\n') + '\n' : "" +
            this.getInnerException()?.stack
        }

      } else if ((data as AmsTcpPacket).ams && (data as AmsTcpPacket).ams.error) {
        //AMS reponse with error code
        this.adsError = true
        this.adsErrorInfo = {
          adsErrorType: 'AMS error',
          adsErrorCode: (data as AmsTcpPacket).ams.errorCode,
          adsErrorStr: (data as AmsTcpPacket).ams.errorStr
        }

      } else if ((data as AmsTcpPacket).ads && (data as AmsTcpPacket).ads.error) {
        //ADS response with error code
        this.adsError = true
        this.adsErrorInfo = {
          adsErrorType: 'ADS error',
          adsErrorCode: (data as AmsTcpPacket).ads.errorCode,
          adsErrorStr: (data as AmsTcpPacket).ads.errorStr
        }

      } else if (this.metaData == null) {
        //If something else is provided, save it
        this.metaData = data
      }
    })

    //If this particular exception has no ADS error, check if the inner exception has
    //It should always be passed upwards to the end-user
    if (!this.adsError && this.getInnerException() != null) {
      const inner = this.getInnerException() as ServerException

      if (inner.adsError != null && inner.adsError === true) {
        this.adsError = true
        this.adsErrorInfo = inner.adsErrorInfo
      }
    }
  }
}
