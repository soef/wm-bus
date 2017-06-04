#### WMBUS 

wm-bus for node.js

[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](https://github.com/soef/wm-bus/blob/master/LICENSE)

### Example

 
```
var WMBUS = require('wm-bus').WMBUS;

var config = [
    { manufacturerId: '60092596', aesKey: '1212121212121212'},
    { manufacturerId: '60092599', aesKey: '3434343434343434'}
];

WMBUS.prototype.updateStates = function(){
    if (this.errorcode !== this.cc.ERR_NO_ERROR) {
        adapter.log.error("Error Code: " + this.errorcode + " " + this.errormsg);
        return;
    }
    console.log('name: ' + this.manufacturer + '-' + this.afield_id);
    console.log('encryptionMode: ' + this.encryptionMode);
    for (var i = 0; i < this.datablocks.length; i++) {
        var data = this.datablocks[i];
        console.log('  type: ' + data.type);
        for (var j in data) {
            switch (j) {
                //case 'type':
                case 'unit':
                case 'value':
                    //case 'extension':
                    //case 'functionFieldText':
                    if (data[i]) {
                        console.log('    ' + j + ': ' + data[i]);
                    }
            }
        }
    }
};

var wmbus = new WMBUS(); //(log: log function, formatDate: formatDate Function);

for (var i=0; i < config.length; i++) {
    var device = config[i];
    wmbus.addAESKey(device.manufacturerId, device.aesKey);
}

wmbus.parse('wmbus message');
```
