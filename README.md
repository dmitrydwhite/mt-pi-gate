# `majortom-gateway-server` Usage Guide

## What is `majortom-gateway-server`?
This is an opinionated Gateway App that allows you easily to connect your systems to Major Tom over HTTP, UDP, or USB/Serial. It can run on any machine, but is particularly designed to be run on a simple dedicated device like a Raspberry Pi.

## Use on Raspberry Pi
* Set up your Raspberry Pi for ssh.
* _FOR RASPBERRY PI NON-ZERO_ Install Node JS version 14:

```sh
$ sudo apt-get update
$ sudo apt-get dist-upgrade`
$ curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
$ sudo apt-get install -y nodejs
$ node -v # should output version 14
```

* _FOR RASPBERRY PI ZERO_ Install Node JS version 11:
Node JS stopped distributing a version for the armv6l architecture after Node 11.15.0, so we'll need that one for the Zero:

```sh
curl -o node-v11.15.0-linux-armv6l.tar.gz https://nodejs.org/dist/v11.15.0/node-v11.15.0-linux-armv6l.tar.gz
tar -xzf node-v11.15.0-linux-armv6l.tar.gz
sudo cp -r node-v11.15.0-linux-armv6l/* /usr/local/
node -v # should output version 11
```

## Once NodeJS is installed

* Clone this repo

```sh
$ git clone https://github.com/dmitrydwhite/mt-pi-gate.git
```
* In the newly created directory, install the dependencies

```sh
$ cd mt-pi-gate
$ npm install
```
* Create the required config files, see the [README](./configs/README.md) there

* If you're going to use any USB connections, connect them to the computer that will run the app

* Start the app
```sh
$ npm run gateway
```