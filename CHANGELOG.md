# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 25.11.2021
### Added
- New `StandAloneServer` class
  - A new ADS server for systems without TwinCAT installation / AMS router
    - AdsRouterConsole or similar no more needed
    - Example: Raspberry Pi, Linux, etc..
  - Listens for incoming connections at TCP port (default 48898) so no router needed
  - Can listen and respond to requests to any ADS port

### Changed
- Old code divided into `Server` and `ServerCore` (internal) classes
- `Server` class connecting, disconnecting and reconnecting redesigned
- `Server` class reconnecting after connection loss redesigned
- All request callbacks (like `onReadReq`) now have 4th parameter: `adsPort`
  - Contains the ADS port where the command was sent to
  - Required with `StandAloneServer` as it listens to all ADS ports
- Better typings for `onAddNotification`
- Lots of small improvements

## [1.0.0] - 20.11.2021
### Changed
- Bugfix: `_registerAdsPort` caused unhandled exception if using manually given AmsNetID.
- NOTE: Updated version to 1.0.0 but everything is backwards compatible

## [0.2.2] - 16.01.2021
### Changed
- Minor changes to console warning messages

## [0.2.0] - 07.01.2021
### Changed
- Updated README
- Updated `sendDeviceNotification()`
- Small fixes
- Added ./example

## [0.1.0] - 05.01.2021
### Added
- First public release
- Everything should work somehow
- `sendDeviceNotification()` is not ready, but should work for testing