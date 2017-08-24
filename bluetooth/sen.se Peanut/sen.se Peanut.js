class Peanut {
 //Konstruktor
 constructor() {
   this.device = null;
   this.onDisconnected = this.onDisconnected.bind(this);
 }
 
 
 //SensePeanut are used to return only devices that match some advertised Bluetooth GATT services and/or the device name
 request() {
   let options = {
     'filters': [{ 'name': 'SensePeanut' }],
     'optionalServices': ['93cd3ce1-58d0-4757-8767-3a9e03511f43']
   };
  
  //Scan for a device with bluetooth Service
  //takes a mandatory obeject, that defines filters (= SensePeanut) or 'optionalServices'
   return navigator.bluetooth.requestDevice(options)
   .then(device => {
     this.device = device;
     this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
     return device;
   });
 }
 //Method to connect
 connect() {
   let requestDevice = Promise.resolve();
   if (!this.device) {
     requestDevice = this.request();
   }
   return requestDevice.then(_ => {
    //Attempts to connect to remote GATT Server
     if (this.device.gatt.connected &&
         this._commandCharacteristic &&
         this._ackCharacteristic) {
       return Promise.resolve();
     }
    
 return this.device.gatt.connect()
    // Note that we could also get all services that match a specific UUID by passing it to getPrimaryServices()
     .then(server => server.getPrimaryService('93cd3ce1-58d0-4757-8767-3a9e03511f43'))
     .then(service => Promise.all([
       service.getCharacteristic('780a1f13-6153-487a-8be7-38c9058fc322'),
       service.getCharacteristic('a2cb1256-6ba8-48de-98b6-d5989f26a203')
     ]))
 
     .then(characteristics => {
       [this._commandCharacteristic, this._ackCharacteristic] = characteristics;
     });
   });
 }
  
 // Get the InitData and compare
 getInitData() {
   return this._commandCharacteristic.writeValue(new Uint8Array([10]))
   .then(_ => this._commandCharacteristic.readValue())
   .then(value => {
     if (value.getUint8(0) !== 10) {
       return Promise.reject('Unexpected ID when reading command characteristic');
     }
    //declares the initialiation data of the peanuts
    let initData = {
       bootloaderId: value.getUint8(6),
       usageId: value.getUint8(7),
       firmwareId: value.getUint8(8),
       bufferSize: (value.getUint8(15) | value.getUint8(16) << 8)
     }
    // return value 
     return initData;
   });
 }
// get MacAddress from Peanuts and compare 
 getMacAddress() {
   return this._commandCharacteristic.writeValue(new Uint8Array([100]))
   .then(_ => this._commandCharacteristic.readValue())
   .then(value => {
     if (value.getUint8(0) !== 100) {
       return Promise.reject('Unexpected ID when reading command characteristic');
     }
    
     let bytes = [];
     for (let i = 6; i < 12; i++) {
       bytes.push(('00' + value.getUint8(i).toString(16).toUpperCase()).slice(-2));
     }
     let macAddress = bytes.join(':');
    //return value
     return macAddress;
   });
 }
// Get Text on Display
 getPlainText() {
   return this._commandCharacteristic.writeValue(new Uint8Array([50]))
   .then(_ => this._commandCharacteristic.readValue())
   .then(value => {
    if (value.getUint8(0) !== 50) {
       return Promise.reject('Unexpected ID when reading command characteristic');
     }
     let data = new Uint8Array(value.buffer, 6, 16);
     return data;
   });
 }

 //Important for Bluetooth
 setFactoryCipher(authKey, clearText) {
   let keyData = new Uint8Array(authKey.match(/.{1,2}/g).map(i => parseInt(i, 16)).reverse());
   // AES-EBD is same as AES_CDB when IV is null and clearText is 16 bytes.
   return crypto.subtle.importKey('raw', keyData, {name: 'AES-CBC'}, true, ['encrypt'])
   .then(k => crypto.subtle.encrypt({ name: 'AES-CBC', iv: new ArrayBuffer(16) }, k, clearText.reverse()))
   .then(encrypted => {
     let reversedEncrypted = new Uint8Array(encrypted, 0, 16).reverse();
     let data = new Uint8Array(17);
     data.set(new Uint8Array([51]), 0);
     data.set(reversedEncrypted, 1);
     return this._commandCharacteristic.writeValue(data);
   })
   .then(_ => this._commandCharacteristic.readValue())
   .then(value => {
     if (value.getUint8(0) !== 52) {
       return Promise.reject('Unexpected ID when reading command characteristic');
     }
     if (value.getUint8(6) !== 0) {
       return Promise.reject('Incorrect ciphertext');
     }
     return value;
   })
 }

 //get current date and time in seconds
 setTime() {
   let seconds = Math.floor( Date.now() / 1000 );
   let data = new Uint8Array([1, seconds, seconds >> 8, seconds >> 16, seconds >> 24, 0]);
   return this._commandCharacteristic.writeValue(data);
 }

 
 updateConnectionParameters() {
   // Max connection interval in ms from 25 to 2000
   let intervalMax = 100;
   // Number of packets missed before triggering a connection timeout (from 0 to 6)
   let slaveLatency = 4;
   // Supervision timeout in ms from 1000 to 6000
   let supervisionTimeout = 20000;
   let data = new Uint8Array([103, intervalMax / 12.5, 4, supervisionTimeout / 100]);
   return this._commandCharacteristic.writeValue(data);
 }

 /* ThermoPeanut */
  
 //Method, that will go through when clicking on button
 getTemperature() {
   return this._commandCharacteristic.writeValue(new Uint8Array([4]))
   .then(_ => this._commandCharacteristic.readValue())
   .then(value => {
     if (value.getUint8(0) !== 4) {
       return Promise.reject('Unexpected ID when reading command characteristic');
     }
     return this._parseNotifications(value);
   });
 }

 /*Common  */

 //Method, that will go through when clicking on button
 buzz() {
   return this._commandCharacteristic.writeValue(new Uint8Array([5]))
 }

 //Method, that will go through when clicking on button
 getBattery() {
   return this._commandCharacteristic.writeValue(new Uint8Array([3]))
   .then(_ => this._commandCharacteristic.readValue())
   .then(value => {
     if (value.getUint8(0) !== 1) {
      return Promise.reject('Unexpected ID when reading command characteristic');
     }
     return this._parseNotifications(value);
   });
 }

 //start Notification
 startNotifications(listener) {
   return this._ackCharacteristic.startNotifications()
   .then(_ => {
     this._ackCharacteristic.oncharacteristicvaluechanged = event => {
       this._ackAndParseNotifications(event.target.value)
       .then(data => listener(data, this));
     };
   });
 }
//stop Notifications
 stopNotifications() {
   return this._ackCharacteristic.stopNotifications()
   .then(_ => {
     this._ackCharacteristic.oncharacteristicvaluechanged = null;
   });
 }

 _ackAndParseNotifications(value) {
   let counterId = value.getUint8(1);
   return this._ackCharacteristic.writeValue((new Uint8Array([254, counterId])))
   .then(_ => this._parseNotifications(value));
 }
// parse Notifications from Peanut
 // battery level
 // alert
 // temperature
 _parseNotifications(value) {
   let data = {
     timeStampMs: this._parseTimestamp(value)
   };
   switch (value.getUint8(0)) {
     case 1:
       data.batteryLevel = this._parseBatteryData(value);
       break;
     case 3:
       data.alert = this._parseAlertData(value);
       break;
     case 4:
       data.temperatureCelsius = this._parseTemperatureData(value);
       break;
    
 
     default:
       let bytes = [];
       for (let i = 0; i < value.byteLength; i++) {
         bytes.push(value.getUint8(i));
       }
       data.unknown = bytes.join(' ');
   }
   return data;
 }
  //Parse Timestamp from peanut
 _parseTimestamp(value) {
   let timeStampSeconds = value.getUint8(2) | value.getUint8(3) << 8 | value.getUint8(4) << 16 | value.getUint8(5) << 24;
   let counterId = value.getUint8(1);
   return timeStampSeconds * 1000 + counterId;
 }
 // parse Alert Data from Peanut
 _parseAlertData(value) {
   let intensity = value.getUint8(6) | value.getUint8(7) << 8;
   return intensity;
 }
// Parse Battery data from Peanut
 _parseBatteryData(value) {
   let batteryData = value.getUint8(6) | value.getUint8(7) << 8;
   if (batteryData >= 2600) {
     return batteryData + 'mV (Good)';
   }
   return batteryData + 'mV (Low)';
 }
//Parse Temperatre value from Peanut
 _parseTemperatureData(value) {
   return parseFloat((((value.getUint8(6) | (value.getUint8(7) << 8)) / 100) - 273.15).toFixed(2));
 }

//Method if device is disconnect
 disconnect() {
   if (!this.device) {
     return Promise.reject('Device is not connected.');
   } else {
     return this.device.gatt.disconnect();
   }
 }
 
 onDisconnected() {
   console.log('Device is disconnected.');
 }
}
