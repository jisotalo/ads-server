# ads-server


[![npm version](https://img.shields.io/npm/v/ads-server)](https://www.npmjs.org/package/ads-server)
[![GitHub](https://img.shields.io/badge/View%20on-GitHub-brightgreen)](https://github.com/jisotalo/ads-server)
[![License](https://img.shields.io/github/license/jisotalo/ads-server)](https://choosealicense.com/licenses/mit/)

TwinCAT ADS server for Node.js (unofficial). Listens for incoming ADS protocol commands and responds.

If you need an ADS client for reading/writing PLC values, see my other project [ads-client](https://github.com/jisotalo/ads-client).


# Project status

Currently in testing. Should work OK.


# NOTE

This is my first project with Typescript, so it probably includes lot's of things to be done differently.

# Table of contents
- [Installing and configuration](#installing-and-configuration)
- [Available ADS commands](#available-ads-commands)
  * [Read request](#read-request)
  * [Write request](#write-request)
  * [ReadWrite requests](#readwrite-requests)
  * [ReadDeviceInfo requests](#readdeviceinfo-requests)
  * [ReadState requests](#readstate-requests)
  * [WriteControl requests](#writecontrol-requests)
  * [AddNotification requests](#addnotification-requests)
  * [DeleteNotification requests](#deletenotification-requests)
  * [Sending a notification](#sending-a-notification)
- [Example: All example codes as a working version](#example--all-example-codes-as-a-working-version)
- [Example: How to display full ADS packet from (debug etc.)](#example--how-to-display-full-ads-packet-from--debug-etc-)
- [Example: Handling device notifications with ads-client](#example--handling-device-notifications-with-ads-client)
- [Debugging](#debugging)
  * [Enabling debug from code](#enabling-debug-from-code)
  * [Enabling debugging from terminal](#enabling-debugging-from-terminal)
- [License](#license)

# Installing and configuration

The localAdsPort can be any non-reserved ADS port. See `ADS_RESERVED_PORTS` type at [src/ads-commons.ts](https://github.com/jisotalo/ads-server/blob/master/src/ads-commons.ts). A port number over 20000 should be OK.

It should be always provided to ensure a static ADS port. Otherwise, the router provides next free one which always changes -> PLC/client code needs to be changed.

Javascript:
```js
const { Server } = require('ads-server')

const server = new Server({
  localAdsPort: 30012
})

//Connect to the local AMS router
server.connect()
  .then(conn => {
    console.log('Connected:', conn)
  })
  .catch(err => {
    console.log('Connecting failed:', err)
  })
```

Typescript:
```ts
import { Server } from 'ads-server'

//Creating a new server instace at ADS port 30012
const server = new Server({
  localAdsPort: 30012
})

//Connect to the local AMS router
server.connect()
  .then(conn => {
    console.log('Connected:', conn)
  })
  .catch(err => {
    console.log('Connecting failed:', err)
  })

```
The setting are provided when creating the Server object and they are all optional. As default, the Server connects to the local AMS router running at localhost but it can be changed from settings.

Available settings:

```ts
{
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
  /** Optional: If true, no warnings are written to console (= nothing is ever written to console) (default: false) */
  hideConsoleWarnings: boolean,
  /** Optional: If true and connection to the router is lost, the server tries to reconnect automatically (default: true) */
  autoReconnect: boolean,
  /** Optional: Time (milliseconds) how often the lost connection is tried to re-establish (default: 2000) */
  reconnectInterval: number,
}
```

# Available ADS commands

In this chapter each available feature is explained shortly. Also a correspoding client-side PLC code is shown.

## Read request

**Client reads a value from the server.**

Node.js (server):
```ts
server.onReadReq(async (req, res) => {
  console.log('Read request received:', req)

  //Create an INT value of 4455
  const data = Buffer.alloc(2)
  data.writeInt16LE(4455)

  //Respond with data
  await res({ data })
    .catch(err => console.log('Responding failed:', err))

  /* Or to respond with an error:
  await res({
    error: 1793 //ADS error code, for example 1793 = Service is not supported by server
  }).catch(err => console.log('Responding failed:', err)) */
})
```

TwinCAT (client):
```Pascal
VAR
	AdsRead 	: Tc2_System.ADSREADEX;
	ReadValue	: INT;
	ReadCmd		: BOOL;
END_VAR

//When ReadCmd is TRUE, a value is read from localhost and ADS port 30012
AdsRead(
	NETID	:= , 
	PORT	:= 30012, 
	IDXGRP	:= 10,
	IDXOFFS	:= 100,
	LEN		:= SIZEOF(ReadValue), 
	DESTADDR:= ADR(ReadValue), 
	READ	:= ReadCmd,
);

IF NOT AdsRead.BUSY THEN
	//Now ReadValue should be 4455 or AdsReader.ERR is true and AdsReader.ERRID is the error code
	ReadCmd := FALSE;
END_IF
```

## Write request

**Client writes a value to the server.**

Node.js (server):
```ts
server.onWriteReq(async (req, res) => {
  console.log('Write request received:', req)

  //Do something with the given data
  console.log('Writing', req.data.byteLength, 'bytes of data')
  
  //Respond OK
  await res({})
    .catch(err => console.log('Responding failed:', err))
    
  /* Or to respond with an error:
  await res({
    error: 1793 //ADS error code, for example 1793 = Service is not supported by server
  }).catch(err => console.log('Responding failed:', err)) */
})
```


TwinCAT (client):
```Pascal
VAR
	AdsWrite 	: Tc2_System.ADSWRITE;
	WriteValue	: INT := 5555;
	WriteCmd	: BOOL;
END_VAR

//When WriteCmd is TRUE, a value is written to localhost and ADS port 30012
AdsWriter(
	NETID	:= , 
	PORT	:= 30012, 
	IDXGRP	:= 10,
	IDXOFFS	:= 100,
	LEN		:= SIZEOF(WriteValue), 
	SRCADDR	:= ADR(WriteValue), 
	WRITE	:= WriteCmd
);

IF NOT AdsWrit.BUSY THEN
	WriteCmd := FALSE;
END_IF
```

## ReadWrite requests

**Client writes a value to the server and waits for response data.**

Node.js (server):
```ts
server.onReadWriteReq(async (req, res) => {
  console.log('ReadWrite request received:', req)

  //Do something with the given data
  const requestedValue = server.trimPlcString(req.data.toString('ascii'))
  console.log('Requested value: ', requestedValue)

  //This example does not care about index group and index offset
  //Instead we just check the received data
  if (requestedValue === 'Temperature 1') {

    //Create an REAL value of 27.678
    const data = Buffer.alloc(4)
    data.writeFloatLE(27.678)

    //Respond with data
    await res({ data }).catch(err => console.log('Responding failed:', err))

  } else {

    await res({
      error: 1793 //ADS error code, for example 1793 = Service is not supported by server
    }).catch(err => console.log('Responding failed:', err))
  }
})
```


TwinCAT (client):
```Pascal
VAR
	AdsReadWriter	: Tc2_System.ADSRDWRTEX;
	RW_WriteValue	: STRING := 'Temperature 1';
	RW_ReadValue	: REAL;
	ReadWriteCmd	: BOOL;
END_VAR

//When ReadWriteCmd is TRUE, a value is written to localhost and ADS port 30012 and result is read
AdsReadWriter(
	NETID	:= , 
	PORT	:= 30012, 
	IDXGRP	:= 10,
	IDXOFFS	:= 100,
	WRITELEN:= SIZEOF(RW_WriteValue), 
	READLEN	:= SIZEOF(RW_ReadValue), 
	SRCADDR	:= ADR(RW_WriteValue),  
	DESTADDR:= ADR(RW_ReadValue), 
	WRTRD	:= ReadWriteCmd
);

IF NOT AdsReadWriter.BUSY THEN
	ReadWriteCmd := FALSE;
END_IF
```

## ReadDeviceInfo requests

**Client reads device (server) info.**

Node.js (server):
```ts
server.onReadDeviceInfo(async (req, res) => {
  console.log('ReadDeviceInfo request received')

  //Respond with data
  res({
    deviceName: 'Server example',
    majorVersion: 5,
    minorVersion: 123,
    versionBuild: 998
  })

  /* Or to respond with an error:
  await res({
    error: 1793 //ADS error code, for example 1793 = Service is not supported by server
  }).catch(err => console.log('Responding failed:', err)) */
})
```

TwinCAT (client):
```Pascal
VAR
	AdsReadDevInfo	: Tc2_System.ADSRDDEVINFO;
	ReadDevInfoCmd	: BOOL;
END_VAR

//When ReadDevInfoCmd is TRUE, device info is read from localhost and ADS port 30012
AdsReadDevInfo(
	NETID	:= , 
	PORT	:= 30012,
	RDINFO	:= ReadDevInfoCmd
);

IF NOT AdsReadDevInfo.BUSY THEN
	//NOTE: ADS protocol has major version, minor version and build version unlike the ADS PLC block
	// -> version is corrupted
	ReadDevInfoCmd := FALSE;
END_IF
```
## ReadState requests

**Client reads device (server) state.**

You can use the `ADS_STATE` constant values from exported `ADS` object if you like.

Node.js (server):
```ts
server.onReadState(async (req, res) => {
  console.log('ReadState request received')

  //Respond with data
  await res({
    adsState: ADS.ADS_STATE.Config, //Or just any number
    deviceState: 123
  }).catch(err => console.log('Responding failed:', err))
  
  /* Or to respond with an error:
  await res({
    error: 1793 //ADS error code, for example 1793 = Service is not supported by server
  }).catch(err => console.log('Responding failed:', err)) */
})
```

TwinCAT (client):
```Pascal
VAR
	AdsReadDevState	: Tc2_System.ADSRDSTATE;
	ReadDevStateCmd	: BOOL;
END_VAR

//When AdsReadDevState is TRUE, device state is read from localhost and ADS port 30012
AdsReadDevState(
	NETID	:= , 
	PORT	:= 30012,
	RDSTATE	:= ReadDevStateCmd
);

IF NOT AdsReadDevState.BUSY THEN
	ReadDevStateCmd := FALSE;
END_IF
```

## WriteControl requests

**Client commands the device (server) to a given state. Also additional data can be provided.**

Node.js (server):
```ts
server.onWriteControl(async (req, res) => {
  console.log('WriteControl request received:', req)

  //Do something with req
  const dataStr = server.trimPlcString(req.data.toString('ascii'))
  console.log('Requested ADS state:', req.adsStateStr, ', provided data:', dataStr)

  //Respond OK
  res({}).catch(err => console.log('Responding failed:', err))

  /* Or to respond with an error:
  await res({
    error: 1793 //ADS error code, for example 1793 = Service is not supported by server
  }).catch(err => console.log('Responding failed:', err)) */
})
```

TwinCAT (client):
```Pascal
VAR
	AdsWriteCtrl 	: Tc2_System.ADSWRTCTL;
	WriteCtrlData	: STRING := 'Some test data to write control';
	WriteCtrlCmd	: BOOL;
END_VAR

//When WriteCtrlCmd is TRUE, values are written to localhost and ADS port 30012
AdsWriteCtrl(
	NETID	:= , 
	PORT	:= 30012,
	ADSSTATE:= ADSSTATE_RUN, 
	DEVSTATE:= 123, 
	LEN		:= SIZEOF(WriteCtrlData), 
	SRCADDR	:= ADR(WriteCtrlData), 
	WRITE	:= WriteCtrlCmd
);

IF NOT AdsWriteCtrl.BUSY THEN
	WriteCtrlCmd := FALSE;
END_IF
```

## AddNotification requests

**Client requests to have notifications based on given settings (subscribes).**

Not available with a PLC as a client, see an example with `ads-client` later.

Node.js (server):
```ts
server.onAddNotification(async (req, res) => {
  console.log('AddNotification request received:', req)

  //Do something with the given req and create an unique notification handle
  const notificationHandle = 1

  //Respond with data
  res({ notificationHandle })
    .catch(err => console.log('Responding failed:', err))
    
  /* Or to respond with an error:
  await res({
    error: 1793 //ADS error code, for example 1793 = Service is not supported by server
  }).catch(err => console.log('Responding failed:', err)) */
})
```

## DeleteNotification requests

Client requests to delete an existing notifications by given handle (unsubscribes). Previously create with AddNotification command. 

Not available with a PLC as a client, see an example with `ads-client` later.

Node.js (server):
```ts
server.onDeleteNotification(async (req, res) => {
  console.log('DeleteNotification request received:', req)

  //Delete existing notification by given req
  console.log('Removing handle ', req.notificationHandle)

  //Respond OK
  res({})
    .catch(err => console.log('Responding failed:', err))
    
  /* Or to respond with an error:
  await res({
    error: 1793 //ADS error code, for example 1793 = Service is not supported by server
  }).catch(err => console.log('Responding failed:', err)) */
})
```

## Sending a notification

**Server sends data based on previously created notification to the client.**

Not available with a PLC as a client, see an example with `ads-client` later.


Node.js (server):
```ts
const data = Buffer.alloc(81)
data.write('Sending some string as notification', 'ascii')

await server.sendDeviceNotification({
  notificationHandle: 1, //Previously saved
  targetAdsPort: 851, //Previously saved
  targetAmsNetId: '192.168.1.2.1.1' //Previously saved
}, data)
```

# Example: All example codes as a working version

Please see `./example` directory in the repository for working example (both PLC and server side).

**To run the example:**
1. Navigate to `./example` and Initialize a new package  
```js
npm init -y
```
2. Install `ads-server`
```js
npm i ads-server
```

3. Run the code
```js
node example.js
```


and then import the PLC code to your project and call the `PRG_AdsServerExample` program. Force commands manually to test each ADS command.

The PLC code is exported as PlcOpenXML format.

# Example: How to display full ADS packet from (debug etc.)

In the examples above, a callback of type `(req, res)` is provided for each function. It is also possible to provide 3rd parameter `(req, res, packet)` for debuggin purposes.

```ts
server.onReadReq(async (req, res, packet) => {
  console.log('Full packet is:', packet)
  //...
```

Example console output:
```ts
Full packet is: {
  amsTcp: { command: 0, commandStr: 'Ads command', dataLength: 44 },
  ams: {
    targetAmsNetId: '192.168.5.131.1.1',
    targetAdsPort: 30012,
    sourceAmsNetId: '192.168.5.131.1.1',
    sourceAdsPort: 350,
    adsCommand: 2,
    adsCommandStr: 'Read',
    stateFlags: 4,
    stateFlagsStr: 'AdsCommand, Tcp, Request',
    dataLength: 12,
    errorCode: 0,
    invokeId: 4278255622,
    error: false,
    errorStr: ''
  },
  ads: { indexGroup: 10, indexOffset: 100, readLength: 2 }
}
```

# Example: Handling device notifications with ads-client

The PLC seems not to have any functionality to register notifications. So it's only available for 3rd party clients. For example using `subscribe()` in [ads-client](https://github.com/jisotalo/ads-client) library.

The following example listens for certain AddNotification requests (`indexGroup = 10, indexOffset = 100, dataLength = 2`) and saves them. Then notifications are sent, until cancelled with DeleteNotification request.

**Server side:**
```js
const { Server } = require('ads-server')
//For Typescript: import { Server } from 'ads-server'
//For Typescript: import { AdsNotificationTarget } from 'ads-server/dist/types/ads-server'

const server = new Server({
  localAdsPort: 30012
})


let freeHandle = 0
let subscribers = []
//For Typescript: let subscribers: Array<AdsNotificationTarget & { cycleTime: number, lastSendTime: number }> = []


server.connect()
  .then(async conn => {
    console.log(`Connected: ${JSON.stringify(conn)}`)

    //-------------------------------------
    // Timer that sends the notifications
    //-------------------------------------
    setInterval(async () => {
      //Our data is an INT of current seconds
      const data = Buffer.alloc(2)
      data.writeInt16LE(new Date().getSeconds())

      //Loop each subscribers and check if enough time has passed
      for (const sub of subscribers) {

        if (new Date().getTime() - sub.lastSendTime > sub.cycleTime || sub.cycleTime === 0) {
          //Time to send, this should actually be done in parallel
          await server.sendDeviceNotification(sub, data)
            .then(() => sub.lastSendTime = new Date().getTime())
            .catch(err => console.log('Sending notification failed:', err))
        }
      }
    }, 100)


    //-------------------------------------
    // Listening for new subscribers
    //-------------------------------------
    server.onAddNotification(async (req, res) => {
      console.log('AddNotification request received:', req)

      //Is the request valid?
      if (req.indexGroup === 10 && req.indexOffset === 100 && req.dataLength === 2) {

        const notificationHandle = freeHandle++

        req.notificationTarget.notificationHandle = notificationHandle

        subscribers.push({
          ...req.notificationTarget,
          cycleTime: req.cycleTime,
          lastSendTime: 0
        })

        await res({ notificationHandle })
          .then(() => console.log('New subscriber registered with handle', notificationHandle))
          .catch(err => console.log('Responding failed:', err))

      } else {
        //Unknown request
        res({ error: 1808 }) //1808 = symbol not found
          .catch(err => console.log('Responding failed:', err))
      }
    })


    //-------------------------------------
    // Listening for unsubscribe requests
    //-------------------------------------
    server.onDeleteNotification(async (req, res) => {
      console.log('DeleteNotification request received:', req)

      //Delete existing notification
      if (subscribers.find(sub => sub.notificationHandle === req.notificationHandle)) {
        //Found, remove it 
        subscribers = subscribers.filter(sub => sub.notificationHandle !== req.notificationHandle)

        //Respond OK
        await res({})
          .then(() => console.log('Subscriber with handle', req.notificationHandle, 'removed'))
          .catch(err => console.log('Responding failed:', err))

      } else {
        //Unknown handle
        await res({ error: 1812 }) //1812 = Notification handle is invalid	
          .catch(err => console.log('Responding failed:', err))
      }
    })
  })
```

**Client side (uses ads-client library)**
```js
const { Client } = require('ads-client')

const client = new Client({
  targetAmsNetId: 'localhost',
  targetAdsPort: 30012,
  allowHalfOpen: true //IMPORTANT: We don't have PLC as it's our own server
})

client.connect()
  .then(async () => {
    console.log('Connected')

    try {
      //Subscribe with 1s cycle time
      const sub = await client.subscribeRaw(10, 100, 2, async data => {
        console.log('Notification received:', data, '- value as INT:', data.value.readInt16LE())
      }, 1000)

      console.log('Subscribed')

      //Unsubscribing after 10 seconds
      setTimeout(async () => {
        await sub.unsubscribe()
        console.log('Unsubscribed')
      }, 10000)

    } catch (err) {
      console.log('Something went wrong:', err)
    }
  })
  .catch(err => console.log('Failed to connect:', err))
```
# Debugging

To debug each received packet, see: [Example: How to display full ADS packet from (debug etc.)](#example--how-to-display-full-ads-packet-from--debug-etc-)

If you have problems or you are interested, you can enabled debug output to console. The ads-server uses `debug` package for debugging.

Debugging can be enabled from terminal or from code.

## Enabling debug from code

You can change the debug level with method `setDebugging(level)`:
```js
server.setDebugging(2)
```
Different debug levels explained:
- 0: No debugging (default)
- 1: Errors have full stack traces, no debug printing
- 2: Basic debug printing (same as `DEBUG='ads-server'`) 
- 3: Detailed debug printing (same as `DEBUG='ads-server,ads-server:details'`)
- 4: Detailed debug printing and raw I/O data (same as `DEBUG='ads-server*'`)

## Enabling debugging from terminal
See the [debug package](https://www.npmjs.com/package/debug) for instructions.

Example for Visual Studio Code (PowerShell):
```bash
$env:DEBUG='ads-server,ads-server:details'
```

Different debug levels explained:
- Basic debug printing `DEBUG='ads-server'`
- Basic and detailed debug printing `DEBUG='ads-server,ads-server:details'`
- Basic, detailed and raw I/O data: `DEBUG='ads-server*'`


# License

Licensed under [MIT License](http://www.opensource.org/licenses/MIT) so commercial use is possible. Please respect the license, linking to this page is also much appreciated.

Copyright (c) 2021 Jussi Isotalo <<j.isotalo91@gmail.com>>

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
