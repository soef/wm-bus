

var WMBUSController = {

    /**
     * @return {number}
     */
    CF_TIMESTAMP: function (x) {
        return (x & 0x20);
    },
    CF_RSSI: function (x) {
        return (x & 0x40);
    },
    CF_CRC16: function (x) {
        return (x & 0x80);
    },
    /**
     * @return {number}
     */
    CF_ENDPOINTID: function (x) {
        return (x & 0x0F);
    },

    RADIOT2: 4,
    RADIOT1: 3,
    RADIOS2: 2,
    RADIOS1: 1,

    AES_KEYLENGHT_IN_BYTES: 16,
    iM871AIdentifier: 0x33,
    iAMB8465Identifier: 0x27,
    iAMB8665Identifier: 0x53,

    MAX_COMMAND_RESPONSE: 100,
    MAX_HCI_LENGTH: 100,

//HCI Message
    LENGTH_HCI_HEADER: 0x04,
    SOF: 0x00,
    CF_EID: 0x01,
    MID: 0x02,
    LENGTH: 0x03,
    PAYLOAD: 0x04,


    START_OF_FRAME: 0xA5,

    MAXSLOT: 16,
    COMMANDTIMEOUT: 100,
    THREADWAITING: 100,
    SLEEP100MS: (100*1000),
    BUFFER_SIZE: 1024,


//offset in wM-Bus data
    OFFSETPAYLOAD: 3,
    OFFSETMANID: 1,
    OFFSETMBUSID: 3,
    OFFSETVERSION: 7,
    OFFSETTYPE: 8,
    OFFSETACCESSNUMBER: 10,
    OFFSETSTATUS:       11,
    OFFSETCONFIGWORD:   12,
    OFFSETDECRYPTFILLER: 14,


//List of Endpoint Identifier
    DEVMGMT_ID: 0x01,
    RADIOLINK_ID: 0x02,
    RADIOLINKTEST_ID: 0x03,
    HWTEST_ID: 0x04,


//Device Management Message Identifier
    DEVMGMT_MSG_PING_REQ: 0x01,
    DEVMGMT_MSG_PING_RSP: 0x02,
    DEVMGMT_MSG_SET_CONFIG_REQ: 0x03,
    DEVMGMT_MSG_SET_CONFIG_RSP: 0x04,
    DEVMGMT_MSG_GET_CONFIG_REQ: 0x05,
    DEVMGMT_MSG_GET_CONFIG_RSP: 0x06,
    DEVMGMT_MSG_RESET_REQ: 0x07,
    DEVMGMT_MSG_RESET_RSP: 0x08,
    DEVMGMT_MSG_FACTORY_RESET_REQ: 0x09,
    DEVMGMT_MSG_FACTORY_RESET_RSP: 0x0A,
    DEVMGMT_MSG_GET_OPMODE_REQ: 0x0B,
    DEVMGMT_MSG_GET_OPMODE_RSP: 0x0C,
    DEVMGMT_MSG_SET_OPMODE_REQ: 0x0D,
    DEVMGMT_MSG_SET_OPMODE_RSP: 0x0E,
    DEVMGMT_MSG_GET_DEVICEINFO_REQ: 0x0F,
    DEVMGMT_MSG_GET_DEVICEINFO_RSP: 0x10,
    DEVMGMT_MSG_GET_SYSSTATUS_REQ: 0x11,
    DEVMGMT_MSG_GET_SYSSTATUS_RSP: 0x12,
    DEVMGMT_MSG_GET_FWINFO_REQ: 0x13,
    DEVMGMT_MSG_GET_FWINFO_RSP: 0x14,
    DEVMGMT_MSG_GET_RTC_REQ: 0x19,
    DEVMGMT_MSG_GET_RTC_RSP: 0x1A,
    DEVMGMT_MSG_SET_RTC_REQ: 0x1B,
    DEVMGMT_MSG_SET_RTC_RSP: 0x1C,
    DEVMGMT_MSG_ENTER_LPM_REQ: 0x1D,
    DEVMGMT_MSG_ENTER_LPM_RSP: 0x1E,
    DEVMGMT_MSG_SET_AES_ENCKEY_REQ: 0x21,
    DEVMGMT_MSG_SET_AES_ENCKEY_RSP: 0x22,
    DEVMGMT_MSG_ENABLE_AES_ENCKEY_REQ: 0x23,
    DEVMGMT_MSG_ENABLE_AES_ENCKEY_RSP: 0x24,
    DEVMGMT_MSG_SET_AES_DECKEY_REQ: 0x25,
    DEVMGMT_MSG_SET_AES_DECKEY_RSP: 0x26,
    DEVMGMT_MSG_AES_DEC_ERROR_IND: 0x27,

//Radio Link Message Identifier
    RADIOLINK_MSG_WMBUSMSG_REQ: 0x01,
    RADIOLINK_MSG_WMBUSMSG_RSP: 0x02,
    RADIOLINK_MSG_WMBUSMSG_IND: 0x03,
    RADIOLINK_MSG_DATA_REQ: 0x04,
    RADIOLINK_MSG_DATA_RSP: 0x05,



    sendCmd: function sendCmd(soe, cf_eid, mid, payload, callback) {
        if (payload === undefined) payload = '';

        //var s = '';
        //s += String.fromCharCode(soe);
        //s += String.fromCharCode(cf_eid);
        //s += String.fromCharCode(mid);
        //s += String.fromCharCode(payload.length);
        //if (payload.length) s += payload;
        //this.write(s, callback);

        var buf = new Buffer(4 + payload.length);
        buf[0] = soe;
        buf[1] = cf_eid ;
        buf[2] = mid;
        buf[3] = payload.length;
        buf.write(payload);

        //word crc: crc.build()

        this.write(buf, callback);
    },

    devMgmt: function (cmd, payload, callback) {
        if (typeof payload === 'function') {
            callback = payload;
            payload = undefined;
        }
        this.sendCmd(this.START_OF_FRAME, this.DEVMGMT_ID, cmd, payload, callback)
    },

    getInfo: function getInfo(callback) {
        this.sendCmd(this.START_OF_FRAME, this.DEVMGMT_ID, this.DEVMGMT_MSG_GET_DEVICEINFO_REQ, '', callback);
    },

    getConfig: function getConfig(callback) {
        this.sendCmd(this.START_OF_FRAME, this.DEVMGMT_ID, this.DEVMGMT_MSG_GET_CONFIG_REQ, '', callback);
    },

    getSysStatus: function (callback) {
        this.devMgmt(this.DEVMGMT_MSG_GET_SYSSTATUS_REQ, callback)
    },


    setConfig: function (linkMode, callback) {

        linkMode = linkMode | 3;
        var payload = {
            onlyTemporary: 0,     // change configuration only temporary
            iIFlag: 3,            // IIFlag 1; Bit 0 : Device Mode, Bit 1 : Radio Mode
            deviceMode: 0,        // other
            radioMode: linkMode,  // S1=1, S2=2, T1=3, T2=4
            iIFlag2: 0xB0,        // IIFlag2 Auto RSSI, Auto Rx Timestamp, RTC Control
            rssi: 1,              //
            timeStamp1: 1
            //timeStamp2: 1
        };

        var payloadStr = '';
        for (var i in payload) {
            payloadStr += String.fromCharCode(payload[i]);
        }
        this.devMgmt(this.DEVMGMT_MSG_SET_CONFIG_REQ, payloadStr, callback)
    },

    initStick: function (callback) {
        this.setConfig(3, callback);
    },

    write: function send(data, callback) {
    }

};

module.exports = WMBUSController;

