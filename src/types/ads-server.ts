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

import type { Socket } from 'net'
import type { AdsData, AmsTcpPacket } from './ads-types'

/** AMS packet that has device notification helper object */
export interface AddNotificationAmsTcpPacket<T> extends AmsTcpPacket {
  /** ADS data */
  ads: AddNotificationAdsData<T>
}

/** ADS data that has device notification helper object */
export interface AddNotificationAdsData<T> extends AdsData {
  /** Device notification target information (helper object) */
  notificationTarget: T
}

export interface ServerCoreSettings {
  /** Optional: Local AmsNetId to use (default: automatic) */
  localAmsNetId?: string,
  /** Optional: If true, no warnings are written to console (= nothing is ever written to console) (default: false) */
  hideConsoleWarnings?: boolean,
}

export interface StandAloneServerSettings extends ServerCoreSettings {
  /** Local AmsNetId to use */
  localAmsNetId: string,
  /** Optional: Local IP address to use, use this to change used network interface if required (default: '' = automatic) */
  listeningAddress?: string,
  /** Optional: Local TCP port to listen for incoming connections (default: 48898) */
  listeningTcpPort?: number
}

export interface RouterServerSettings extends ServerCoreSettings {
  /** Optional: Target ADS router TCP port (default: 48898) */
  routerTcpPort: number,
  /** Optional: Target ADS router IP address/hostname (default: 'localhost') */
  routerAddress: string,
  /** Optional: Local IP address to use, use this to change used network interface if required (default: '' = automatic) */
  localAddress: string,
  /** Optional: Local TCP port to use for outgoing connections (default: 0 = automatic) */
  localTcpPort: number,
  /** Optional: Local AmsNetId to use (default: automatic) */
  localAmsNetId: string,
  /** Optional: Local ADS port to use (default: automatic/router provides) */
  localAdsPort: number,
  /** Optional: Time (milliseconds) after connecting to the router or waiting for command response is canceled to timeout (default: 2000) */
  timeoutDelay: number,
  /** Optional: If true and connection to the router is lost, the server tries to reconnect automatically (default: true) */
  autoReconnect: boolean,
  /** Optional: Time (milliseconds) how often the lost connection is tried to re-establish (default: 2000) */
  reconnectInterval: number,
}

export interface StandAloneServerConnection {
  /** Connection ID */
  id: number,
  /** Connection socket */
  socket: Socket,
  /** Connection receive data buffer */
  buffer: Buffer
}

export interface TimerObject {
  /** Timer ID */
  id: number,
  /** Timer handle */
  timer?: NodeJS.Timeout
}

/**
 * Generic request callback
 * Just tells that we have req, res and packet properties
 */
export type GenericReqCallback = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
  packet?: AmsTcpPacket | AddNotificationAmsTcpPacket<AdsNotificationTarget> | AddNotificationAmsTcpPacket<StandAloneAdsNotificationTarget>,
  adsPort?: number
) => void

export interface AmsRouterState {
  /** Router state */
  state: number,
  /** Router state as string */
  stateStr: string
}

/**
 * Connection info
 */
export interface ServerConnection {
  /** Is the server connected to the AMS router (`Server`) 
   * or is the server listening for incoming connections (`StandAloneServer`)*/
  connected: boolean,
  /** Local AmsNetId of the server */
  localAmsNetId: string,
  /** Local ADS port of the server (only with `Server`) */
  localAdsPort?: number
}

/**
 * ADS notification target parameters
 */
export interface AdsNotificationTarget {
  /** Notification handle (unique for each registered notification) */
  notificationHandle?: number,
  /** Target system AmsNetId (that subscribed to notifications) */
  targetAmsNetId: string,
  /** Target system ADS port (that subscribed to notifications) */
  targetAdsPort: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * ADS notification target parameters for StandAloneServer
 */
export interface StandAloneAdsNotificationTarget extends AdsNotificationTarget {
  /** Socket to use for sending data */
  socket: Socket,
  /** Source system ADS port */
  sourceAdsPort: number
}

/**
 * Read request callback
 */
export type ReadReqCallback = (
  /** Request data */
  req: ReadReq,
  /** Response callback function (async) */
  res: ReadReqResponseCallback,
  /** AmsTcp full packet */
  packet?: AmsTcpPacket,
  /** ADS port where the request was received */
  adsPort?: number
) => void

/**
 * ReadWrite request callback
 */
export type ReadWriteReqCallback = (
  /** Request data */
  req: ReadWriteReq,
  /** Response callback function (async) */
  res: ReadWriteReqResponseCallback,
  /** AmsTcp full packet */
  packet?: AmsTcpPacket,
  /** ADS port where the request was received */
  adsPort?: number
) => void

/**
 * Write request callback
 */
export type WriteReqCallback = (
  /** Request data */
  req: WriteReq,
  /** Response callback function (async) */
  res: WriteReqResponseCallback,
  /** AmsTcp full packet */
  packet?: AmsTcpPacket,
  /** ADS port where the request was received */
  adsPort?: number
) => void

/**
 * ReadDevice request callback
 */
export type ReadDeviceInfoReqCallback = (
  /** Request data (empty object) */
  req: Record<string, never>,
  /** Response callback function (async) */
  res: ReadDeviceInfoReqResponseCallback,
  /** AmsTcp full packet */
  packet?: AmsTcpPacket,
  /** ADS port where the request was received */
  adsPort?: number
) => void

/**
 * ReadState request callback
 */
export type ReadStateReqCallback = (
  /** Request data (empty object) */
  req: Record<string, never>,
  /** Response callback function (async) */
  res: ReadStateReqResponseCallback,
  /** AmsTcp full packet */
  packet?: AmsTcpPacket,
  /** ADS port where the request was received */
  adsPort?: number
) => void

/**
 * AddNotification request callback
 */
export type AddNotificationReqCallback<T> = (
  /** Request data */
  req: AddNotificationReq,
  /** Response callback function (async) */
  res: AddNotificationReqResponseCallback,
  /** AmsTcp full packet */
  packet?: AddNotificationAmsTcpPacket<T>,
  /** ADS port where the request was received */
  adsPort?: number
) => void

/**
 * DeleteNotification request callback
 */
export type DeleteNotificationReqCallback = (
  /** Request data */
  req: DeleteNotificationReq,
  /** Response callback function (async) */
  res: DeleteNotificationReqResponseCallback,
  /** AmsTcp full packet */
  packet?: AmsTcpPacket,
  /** ADS port where the request was received */
  adsPort?: number
) => void

/**
 * WriteControl request callback
 */
export type WriteControlReqCallback = (
  /** Request data */
  req: WriteControlReq,
  /** Response callback function (async) */
  res: WriteControlReqResponseCallback,
  /** AmsTcp full packet */
  packet?: AmsTcpPacket,
  /** ADS port where the request was received */
  adsPort?: number
) => void

/** ADS request type (any of these) */
export type AdsRequest =
  | EmptyReq
  | UnknownAdsRequest
  | ReadReq
  | ReadWriteReq
  | WriteReq
  | AddNotificationReq
  | DeleteNotificationReq
  | WriteControlReq

/**
 * Unknown ads request
 */
export interface UnknownAdsRequest {
  error: boolean,
  errorStr: string,
  errorCode: number
}

/**
 * Empty ads request (no payload)
 */
export type EmptyReq = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in any]: never //allow only empty object
}

/**
 * Read request data
 */
export interface ReadReq {
  /** Index group the read command is targeted to*/
  indexGroup: number,
  /** Index offset the read command is targeted to*/
  indexOffset: number,
  /** Requested read data length (bytes)*/
  readLength: number
}

/**
 * ReadWrite request data
 */
export interface ReadWriteReq {
  /** Index group the read command is targeted to*/
  indexGroup: number,
  /** Index offset the read command is targeted to*/
  indexOffset: number,
  /** Requested read data length (bytes)*/
  readLength: number,
  /** Write data length (bytes), should be same as data.byteLength*/
  writeLength: number,
  /** Data to write (Buffer)*/
  data: Buffer
}

export interface WriteReq {
  /** Index group the write command is targeted to*/
  indexGroup: number,
  /** Index offset the write command is targeted to*/
  indexOffset: number,
  /** Write data length (bytes), should be same as data.byteLength*/
  writeLength: number,
  /** Data to write (Buffer)*/
  data: Buffer
}

export interface AddNotificationReq {
  /** Index group the notification request is targeted to*/
  indexGroup: number,
  /** Index offset the notification request is targeted to*/
  indexOffset: number,
  /** Data length (bytes) - how much data is wanted to get every notification*/
  dataLength: number,
  /** ADS notification transmission mode */
  transmissionMode: number,
  /** ADS notification transmission mode as string */
  transmissionModeStr: string,
  /** Maximum delay (ms) */
  maximumDelay: number,
  /** How often the value is checked or sent, depends on the transmissionMode (ms) */
  cycleTime: number,
  /** Helper object that can be used to send notifications - NOTE: notificationHandle is empty*/
  notificationTarget: AdsNotificationTarget
  /** Reserved for future use */
  reserved?: Buffer
}

export interface DeleteNotificationReq {
  /** Notification unique handle */
  notificationHandle: number
}

export interface WriteControlReq {
  /** ADS state requested */
  adsState: number,
  /** ADS state requested as string */
  adsStateStr: string,
  /** Device state requested */
  deviceState: number,
  /** Length of the data (should be same as data.byteLength) */
  dataLen: number,
  /** Data (Buffer)*/
  data: Buffer
}

/**
 * Response callback function
 */
export type ReadReqResponseCallback = (
  /** Data to be responsed */
  response: ReadReqResponse | BaseResponse
) => Promise<void>

/**
 * Response callback function
 */
export type ReadWriteReqResponseCallback = (
  /** Data to be responsed */
  response: ReadWriteReqResponse | BaseResponse
) => Promise<void>

/**
 * Response callback function
 */
export type WriteReqResponseCallback = (
  /** Data to be responsed */
  response: BaseResponse
) => Promise<void>

/**
 * Response callback function
 */
export type ReadDeviceInfoReqResponseCallback = (
  /** Data to be responsed */
  response: ReadDeviceInfoReqResponse | BaseResponse
) => Promise<void>

/**
 * Response callback function
 */
export type ReadStateReqResponseCallback = (
  /** Data to be responsed */
  response: ReadStateReqResponse | BaseResponse
) => Promise<void>

/**
 * Response callback function
 */
export type AddNotificationReqResponseCallback = (
  /** Data to be responsed */
  response: AddNotificationReqResponse | BaseResponse
) => Promise<void>

/**
 * Response callback function
 */
export type DeleteNotificationReqResponseCallback = (
  /** Data to be responsed */
  response: BaseResponse
) => Promise<void>

/**
 * Response callback function
 */
export type WriteControlReqResponseCallback = (
  /** Data to be responsed */
  response: BaseResponse
) => Promise<void>

/**
 * Base response, every response has this
 */
export interface BaseResponse {
  /** ADS/custom error code (if any), can be omitted if no error (default is 0 = no error) */
  error?: number
}

/**
 * Read request response
 */
export interface ReadReqResponse extends BaseResponse {
  /** Data to be responded (Buffer) - can be omitted if nothing to respond */
  data?: Buffer
}

/**
 * ReadWrite request response
 */
export interface ReadWriteReqResponse extends BaseResponse {
  /** Data to be responded (Buffer) - can be omitted if nothing to respond */
  data?: Buffer
}

/**
 * ReadDeviceInfo request response
 */
export interface ReadDeviceInfoReqResponse extends BaseResponse {
  /** Major version number */
  majorVersion?: number,
  /** Minor version number */
  minorVersion?: number,
  /** Build version */
  versionBuild?: number,
  /** Device name */
  deviceName?: string
}

/**
 * ReadState request response
 */
export interface ReadStateReqResponse extends BaseResponse {
  /** ADS state */
  adsState?: number,
  /** Device state */
  deviceState?: number
}

/**
 * AddNotification request response
 */
export interface AddNotificationReqResponse extends BaseResponse {
  /** Notification unique handle */
  notificationHandle?: number
}