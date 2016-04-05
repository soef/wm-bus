#### WMBUS 

wm-bus for node.js


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


### License
The MIT License (MIT)

Copyright (c) 2015-2016 soef <soef@gmx.net>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
