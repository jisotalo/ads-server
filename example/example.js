/*
https://github.com/jisotalo/ads-server
example/example.js

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

const { ADS, Server } = require('ads-server')
//For Typescript: import { ADS, Server } from 'ads-server'

const server = new Server({
  localAdsPort: 30012
})

server.connect()
  .then(async conn => {
    console.log('Connected:', conn)

    //--------------------------
    // Listen for Read requests
    //--------------------------
    server.onReadReq(async (req, res, packet) => {
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


    //--------------------------
    // Listen for Write requests
    //--------------------------
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


    //--------------------------
    // Listen for ReadWrite requests
    //--------------------------
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



    //--------------------------
    // Listen for ReadDeviceInfo requests
    //--------------------------
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



    //--------------------------
    // Listen for ReadState requests
    //--------------------------
    server.onReadState(async (req, res) => {
      console.log('ReadState request received')

      //Respond with data
      await res({
        adsState: ADS.ADS_STATE.Config, //Or just any number (ADS can be imported from ads-server package)
        deviceState: 123
      }).catch(err => console.log('Responding failed:', err))

      /* Or to respond with an error:
      await res({
        error: 1793 //ADS error code, for example 1793 = Service is not supported by server
      }).catch(err => console.log('Responding failed:', err)) */
    })



    //--------------------------
    // Listen for WriteControl requests
    //--------------------------
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

  })
  .catch(err => {
    console.log('Connecting failed:', err)
  })



