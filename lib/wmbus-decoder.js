/*
 *
 * ported from FHEM WMBus.pm # $Id: WMBus.pm 8659 2015-05-30 14:41:28Z kaihs $
 *           http://www.fhemwiki.de/wiki/WMBUS
 * extended by soef
 *
 */

"use strict";

var crypto = require('crypto');
var unpackF = require('./unpack').unpack;

var app = {
    log: {
        debug: console.log,
        error: console.log
    },
    formatDate: function(date, format) {

        function pad(s) {
            return s.length === 1 ? '0' + s : s;
        }

        var s = format.replace('YYYY', date.getYear());
        s = s.replace('MM', pad(date.getMonth()+1));
        s = s.replace('DD', pad(date.getDay()));
        s = s.replace('hh', pad(date.getHours()));
        s = s.replace('mm', pad(date.getMinutes()));
        return s;
    }
};

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var CRC = function () {
    this.polynom = 0x3D65;
    this.initValue = 0;
    this.xor = 0xffff;
    this.table = [];
    for (var i = 0; i < 256; i++) {
        var r = i << 8;
        for (var j = 0; j < 8; j++) {
            //noinspection JSBitwiseOperatorUsage
            if (r & (1 << 15)) {
                r = (r << 1) ^ this.polynom;
            } else {
                r = (r << 1);
            }
        }
        this.table[i] = r;
    }
};

CRC.prototype.build = function (data) {
    var crc = this.initValue;

    for (var i = 0; i < data.length; ++i) {
        var code = data.charCodeAt(i);
        crc = this.table[((crc >> 8) ^ code) & 0xFF] ^ (crc << 8);
    }
    crc ^= this.xor;
    crc &= 0xffff;
    return crc;
};

var crc = new CRC();


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const cc = {
    // Transport Layer block size
    TL_BLOCK_SIZE: 10,
    // Link Layer block size
    LL_BLOCK_SIZE: 16,
    // size of CRC in bytes
    CRC_SIZE: 2,

    // sent by meter
    SND_NR: 0x44,     // Send, no reply
    SND_IR: 0x46,     // Send installation request, must reply with CNF_IR
    ACC_NR: 0x47,
    ACC_DMD: 0x48,

    // sent by controller
    SND_NKE: 0x40,    // Link reset
    CNF_IR: 0x06,

    // CI field
    CI_RESP_4: 0x7a,  // Response from device, 4 Bytes
    CI_RESP_12: 0x72, // Response from device, 12 Bytes
    CI_RESP_0: 0x78,  // Response from device, 0 Byte header, variable length
    CI_ERROR: 0x70,   // Error from device, only specified for wired M-Bus but used by Easymeter WMBUS module
    CI_TL_4: 0x8a,    // Transport layer from device, 4 Bytes
    CI_TL_12: 0x8b,   // Transport layer from device, 12 Bytes

    // DIF types (Data Information Field), see page 32
    DIF_NONE: 0x00,
    DIF_INT8: 0x01,
    DIF_INT16: 0x02,
    DIF_INT24: 0x03,
    DIF_INT32: 0x04,
    DIF_FLOAT32: 0x05,
    DIF_INT48: 0x06,
    DIF_INT64: 0x07,
    DIF_READOUT: 0x08,
    DIF_BCD2: 0x09,
    DIF_BCD4: 0x0a,
    DIF_BCD6: 0x0b,
    DIF_BCD8: 0x0c,
    DIF_VARLEN: 0x0d,
    DIF_BCD12: 0x0e,
    DIF_SPECIAL: 0x0f,

    DIF_IDLE_FILLER: 0x2f,

    DIF_EXTENSION_BIT: 0x80,

    VIF_EXTENSION: 0xFB,                     // true VIF is given in the first VIFE and is coded using table 8.4.4 b) (128 new VIF-Codes)
    VIF_EXTENSION_BIT: 0x80,

    ERR_NO_ERROR: 0,
    ERR_CRC_FAILED: 1,
    ERR_UNKNOWN_VIFE: 2,
    ERR_UNKNOWN_VIF: 3,
    ERR_TOO_MANY_DIFE: 4,
    ERR_UNKNOWN_LVAR: 5,
    ERR_UNKNOWN_DATAFIELD: 6,
    ERR_UNKNOWN_CIFIELD: 7,
    ERR_DECRYPTION_FAILED: 8,
    ERR_NO_AESKEY: 9,
    ERR_UNKNOWN_ENCRYPTION: 10,
    ERR_TOO_MANY_VIFE: 11,
    ERR_MSG_TOO_SHORT: 12,
    ERR_WRONG_AESKEY: 13
};


function valueCalcNumeric(value, dataBlock) {
    var num = value * dataBlock.valueFactor;
    if (dataBlock.valueFactor < 1 && num.toFixed(0) != num) {
        num = num.toFixed(dataBlock.valueFactor.toString().length - 2);
    }
    return num;
}

function valueCalcDate(value, dataBlock) {
    //value is a 16bit int

    //day: UI5 [1 to 5] <1 to 31>
    //month: UI4 [9 to 12] <1 to 12>
    //year: UI7[6 to 8,13 to 16] <0 to 99>

    //   YYYY MMMM YYY DDDDD
    // 0b0000 1100 111 11111 = 31.12.2007
    // 0b0000 0100 111 11110 = 30.04.2007

    var day = (value & b('0b11111'));
    var month = ((value & b('0b111100000000')) >> 8);
    var year = (((value & b('0b1111000000000000')) >> 9) |
        ((value & b('0b11100000')) >> 5)) + 2000;
    if (day > 31 || month > 12 || year > 2099) {
        app.log.error("invalid: " + value);
        return "invalid: " + value;
    }
    var date = new Date(year, month, day);
    return app.formatDate(date, "YYYY-MM-DD");
}

function valueCalcDateTime(value, dataBlock) {
    //#min: UI6 [1 to 6] <0 to 59>
    //#hour: UI5 [9 to13] <0 to 23>
    //#day: UI5 [17 to 21] <1 to 31>
    //#month: UI4 [25 to 28] <1 to 12>
    //#year: UI7[22 to 24,29 to 32] <0 to 99>
    //# IV:
    //# B1[8] {time invalid}:
    //# IV<0> :=
    //#valid,
    //#IV>1> := invalid
    //#SU: B1[16] {summer time}:
    //#SU<0> := standard time,
    //#SU<1> := summer time
    //#RES1: B1[7] {reserved}: <0>
    //#RES2: B1[14] {reserved}: <0>
    //#RES3: B1[15] {reserved}: <0>

    var datePart = value >> 16;
    var timeInvalid = value & b('0b10000000');

    var dateTime = valueCalcDate(datePart, dataBlock);
    if (timeInvalid == 0) {
        var min = (value & b('0b111111'));
        var hour = (value >> 8) & b('0b11111');
        var su = (value & b('0b1000000000000000'));
        if (min > 59 || hour > 23) {
            dateTime = 'invalid: ' + value;
        } else {
            var date = new Date(0);
            date.setHours(hour);
            date.setMinutes(min);
            dateTime = app.formatDate(date, "hh:mm") + su ? 'DST' : '';
        }
    }
    return dateTime;
}

function valueCalcHex(value, dataBlock) {
    return value.toString(16);
}

function valueCalcu(value, dataBlock) {
    //noinspection JSBitwiseOperatorUsage
    return (value & b('0b00001000') ? 'upper' : 'lower') + ' limit';
}

function valueCalcufnn(value, dataBlock) {
    //noinspection JSBitwiseOperatorUsage
    var result = (value & b('0b00001000') ? 'upper' : 'lower') + ' limit';
    //noinspection JSBitwiseOperatorUsage
    result += ', ' + (value & b('0b00000100') ? 'first' : 'last');
    result += ', duration ' + (value & b('0b11'));
    return result;
}

function valueCalcMultCorr1000(value, dataBlock) {
    dataBlock.value *= 1000;
    return "correction by factor 1000";
}

var TimeSpec = {
    0: 's', // seconds
    1: 'm', // minutes
    2: 'h', // hours
    3: 'd'  // days
};


function valueCalcTimeperiod(value, dataBlock) {
    dataBlock.unit = TimeSpec[dataBlock.exponent];
    return value;
}

function b(sBin) {
    return parseInt(sBin.slice(2), 2)
}

// VIF types (Value Information Field), see page 32
const VIFInfo = {
    VIF_ENERGY_WATT: {
        //  10(nnn-3) Wh  0.001Wh to 10000Wh
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b00000000'),
        bias: -3,
        unit: 'Wh',
        calcFunc: valueCalcNumeric
    },
    VIF_ENERGY_JOULE: {
        //  10(nnn) J     0.001kJ to 10000kJ
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b00001000'),
        bias: 0,
        unit: 'J',
        calcFunc: valueCalcNumeric
    },
    VIF_VOLUME: {
        //  10(nnn-6) m3  0.001l to 10000l
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b00010000'),
        bias: -6,
        unit: 'm³',
        calcFunc: valueCalcNumeric
    },
    VIF_MASS: {
        //  10(nnn-3) kg  0.001kg to 10000kg
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b00011000'),
        bias: -3,
        unit: 'kg',
        calcFunc: valueCalcNumeric
    },
    VIF_ON_TIME_SEC: {
        //  seconds
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100000'),
        bias: 0,
        unit: 'sec',
        calcFunc: valueCalcNumeric
    },
    VIF_ON_TIME_MIN: {
        //  minutes
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100001'),
        bias: 0,
        unit: 'min',
        calcFunc: valueCalcNumeric
    },
    VIF_ON_TIME_HOURS: {
        //  hours
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100010'),
        bias: 0,
        unit: 'hours'
    },
    VIF_ON_TIME_DAYS: {
        //  days
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100011'),
        bias: 0,
        unit: 'days'
    },
    VIF_OP_TIME_SEC: {
        //  seconds
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100100'),
        bias: 0,
        unit: 'sec'
    },
    VIF_OP_TIME_MIN: {
        //  minutes
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100101'),
        bias: 0,
        unit: 'min'
    },
    VIF_OP_TIME_HOURS: {
        //  hours
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100110'),
        bias: 0,
        unit: 'hours'
    },
    VIF_OP_TIME_DAYS: {
        //  days
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100111'),
        bias: 0,
        unit: 'days'
    },
    VIF_ELECTRIC_POWER: {
        //  10(nnn-3) W   0.001W to 10000W
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b00101000'),
        bias: -3,
        unit: 'W',
        calcFunc: valueCalcNumeric
    },
    VIF_THERMAL_POWER: {
        //  10(nnn) J/h   0.001kJ/h to 10000kJ/h
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b00110000'),
        bias: 0,
        unit: 'J/h',
        calcFunc: valueCalcNumeric
    },
    VIF_VOLUME_FLOW: {
        //  10(nnn-6) m3/h 0.001l/h to 10000l/h
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b00111000'),
        bias: -6,
        unit: 'm³/h',
        calcFunc: valueCalcNumeric
    },
    VIF_VOLUME_FLOW_EXT1: {
        //  10(nnn-7) m3/min 0.0001l/min to 10000l/min
        typeMask: b('b01111000'),
        expMask: b('0b00000111'),
        type: b('0b01000000'),
        bias: -7,
        unit: 'm³/min',
        calcFunc: valueCalcNumeric
    },
    VIF_VOLUME_FLOW_EXT2: {
        //  10(nnn-9) m3/s 0.001ml/s to 10000ml/s
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b01001000'),
        bias: -9,
        unit: 'm³/s',
        calcFunc: valueCalcNumeric
    },
    VIF_MASS_FLOW: {
        //  10(nnn-3) kg/h 0.001kg/h to 10000kg/h
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b01010000'),
        bias: -3,
        unit: 'kg/h',
        calcFunc: valueCalcNumeric
    },
    VIF_FLOW_TEMP: {
        //  10(nn-3) °C 0.001°C to 1°C
        typeMask: b('0b01111100'),
        expMask: b('0b00000011'),
        type: b('0b01011000'),
        bias: -3,
        unit: '°C',
        calcFunc: valueCalcNumeric
    },
    VIF_RETURN_TEMP: {
        //  10(nn-3) °C 0.001°C to 1°C
        typeMask: b('0b01111100'),
        expMask: b('0b00000011'),
        type: b('0b01011100'),
        bias: -3,
        unit: '°C',
        calcFunc: valueCalcNumeric
    },
    VIF_TEMP_DIFF: {
        //  10(nn-3) K 1mK to 1000mK
        typeMask: b('0b01111100'),
        expMask: b('0b00000011'),
        type: b('0b01100000'),
        bias: -3,
        unit: 'mK',
        calcFunc: valueCalcNumeric
    },
    VIF_EXTERNAL_TEMP: {
        //  10(nn-3) °C 0.001°C to 1°C
        typeMask: b('0b01111100'),
        expMask: b('0b00000011'),
        type: b('0b01100100'),
        bias: -3,
        unit: '°C',
        calcFunc: valueCalcNumeric
    },
    VIF_PRESSURE: {
        //  10(nn-3) bar  1mbar to 1000mbar
        typeMask: b('0b01111100'),
        expMask: b('0b00000011'),
        type: b('0b01101000'),
        bias: -3,
        unit: 'bar',
        calcFunc: valueCalcNumeric
    },
    VIF_TIME_POINT_DATE: {
        //  data type G
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01101100'),
        bias: 0,
        unit: '',
        calcFunc: valueCalcDate
    },
    VIF_TIME_POINT_DATE_TIME: {
        //  data type F
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01101101'),
        bias: 0,
        unit: '',
        calcFunc: valueCalcDateTime
    },
    VIF_HCA: {
        // Unit for Heat Cost Allocator, dimensonless
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01101110'),
        bias: 0,
        unit: '',
        calcFunc: valueCalcNumeric
    },
    VIF_FABRICATION_NO: {
        // Fabrication No
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01111000'),
        bias: 0,
        unit: '',
        calcFunc: valueCalcNumeric
    },
    VIF_OWNER_NO: {
        // Eigentumsnummer (used by Easymeter even though the standard allows this only for writing to a slave)
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01111001'),
        bias: 0,
        unit: ''
    },
    VIF_AVERAGING_DURATION_SEC: {
        //  seconds
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01110000'),
        bias: 0,
        unit: 'sec',
        calcFunc: valueCalcNumeric
    },
    VIF_AVERAGING_DURATION_MIN: {
        //  minutes
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01110001'),
        bias: 0,
        unit: 'min',
        calcFunc: valueCalcNumeric
    },
    VIF_AVERAGING_DURATION_HOURS: {
        //  hours
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01110010'),
        bias: 0,
        unit: 'hours'
    },
    VIF_AVERAGING_DURATION_DAYS: {
        //  days
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01110011'),
        bias: 0,
        unit: 'days'
    },
    VIF_ACTUALITY_DURATION_SEC: {
        //  seconds
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01110100'),
        bias: 0,
        unit: 'sec',
        calcFunc: valueCalcNumeric
    },
    VIF_ACTUALITY_DURATION_MIN: {
        //  minutes
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01110101'),
        bias: 0,
        unit: 'min',
        calcFunc: valueCalcNumeric
    },
    VIF_ACTUALITY_DURATION_HOURS: {
        //  hours
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01110110'),
        bias: 0,
        unit: 'hours'
    },
    VIF_ACTUALITY_DURATION_DAYS: {
        //  days
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01110111'),
        bias: 0,
        unit: 'days'
    }
};

//# Codes used with extension indicator $FD, see 8.4.4 on page 80
var VIFInfo_FD = {
    VIF_CREDIT: {
        //  Credit of 10nn-3 of the nominal local legal currency units
        typeMask: b('0b01111100'),
        expMask: b('0b00000011'),
        type: b('0b00000000'),
        bias: -3,
        unit: '€',
        calcFunc: valueCalcNumeric
    },
    VIF_DEBIT: {
        //  Debit of 10nn-3 of the nominal local legal currency units
        typeMask: b('0b01111100'),
        expMask: b('0b00000011'),
        type: b('0b00000100'),
        bias: -3,
        unit: '€',
        calcFunc: valueCalcNumeric
    },
    VIF_ACCESS_NO: {
        //  Access number (transmission count)
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00001000'),
        bias: 0,
        unit: '',
        calcFunc: valueCalcNumeric
    },
    VIF_MEDIUM: {
        //  Medium (as in fixed header)
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00001001'),
        bias: 0,
        unit: '',
        calcFunc: valueCalcNumeric
    },
    VIF_MODEL_VERSION: {
        //  Model / Version
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00001100'),
        bias: 0,
        unit: '',
        calcFunc: valueCalcNumeric
    },
    VIF_ERROR_FLAGS: {
        // Error flags (binary)
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00010111'),
        bias: 0,
        unit: '',
        calcFunc: valueCalcHex
    },
    VIF_DURATION_SINCE_LAST_READOUT: {
        //  Duration since last readout [sec(s)..day(s)]
        typeMask: b('0b01111100'),
        expMask: b('0b00000011'),
        type: b('0b00101100'),
        bias: 0,
        unit: 's',
        calcFunc: valueCalcTimeperiod
    },
    VIF_VOLTAGE: {
        //  10nnnn-9 Volts
        typeMask: b('0b01110000'),
        expMask: b('0b00001111'),
        type: b('0b01000000'),
        bias: -9,
        unit: 'V',
        calcFunc: valueCalcNumeric
    },
    VIF_ELECTRICAL_CURRENT: {
        //  10nnnn-12 Ampere
        typeMask: b('0b01110000'),
        expMask: b('0b00001111'),
        type: b('0b01010000'),
        bias: -12,
        unit: 'A',
        calcFunc: valueCalcNumeric
    },
    VIF_RECEPTION_LEVEL: {
        //   reception level of a received radio device.
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01110001'),
        bias: 0,
        unit: 'dBm',
        calcFunc: valueCalcNumeric
    },
    VIF_FD_RESERVED: {
        // Reserved
        typeMask: b('0b01110000'),
        expMask: b('0b00000000'),
        type: b('0b01110000'),
        bias: 0,
        unit: 'Reserved'
    }
};

// Codes used with extension indicator $FB
var VIFInfo_FB = {
    VIF_ENERGY: {
        //  Energy 10(n-1) MWh  0.1MWh to 1MWh
        typeMask: b('0b01111110'),
        expMask: b('0b00000001'),
        type: b('0b00000000'),
        bias: -1,
        unit: 'MWh',
        calcFunc: valueCalcNumeric
    }
};


// Codes used for an enhancement of VIFs other than $FD and $FB
var VIFInfo_other = {
    VIF_ERROR_NONE: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00000000'),
        bias: 0,
        unit: 'No error'
    },
    VIF_TOO_MANY_DIFES: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00000001'),
        bias: 0,
        unit: 'Too many DIFEs'
    },

    VIF_ILLEGAL_VIF_GROUP: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00001100'),
        bias: 0,
        unit: 'Illegal VIF-Group'
    },


    VIF_PER_SECOND: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100000'),
        bias: 0,
        unit: 'per second'
    },
    VIF_PER_MINUTE: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100001'),
        bias: 0,
        unit: 'per minute'
    },
    VIF_PER_HOUR: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100010'),
        bias: 0,
        unit: 'per hour'
    },
    VIF_PER_DAY: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100011'),
        bias: 0,
        unit: 'per day'
    },
    VIF_PER_WEEK: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100100'),
        bias: 0,
        unit: 'per week'
    },
    VIF_PER_MONTH: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100101'),
        bias: 0,
        unit: 'per month'
    },
    VIF_PER_YEAR: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100110'),
        bias: 0,
        unit: 'per year'
    },
    VIF_PER_REVOLUTION: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00100111'),
        bias: 0,
        unit: 'per revolution/measurement'
    },
    VIF_PER_INCREMENT_INPUT: {
        typeMask: b('0b01111110'),
        expMask: b('0b00000000'),
        type: b('0b00101000'),
        bias: 0,
        unit: 'increment per input pulse on input channnel #',
        calcFunc: valueCalcNumeric
    },
    VIF_PER_INCREMENT_OUTPUT: {
        typeMask: b('0b01111110'),
        expMask: b('0b00000000'),
        type: b('0b00101010'),
        bias: 0,
        unit: 'increment per output pulse on output channnel #',
        calcFunc: valueCalcNumeric
    },
    VIF_PER_LITER: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00101100'),
        bias: 0,
        unit: 'per liter'
    },

    VIF_START_DATE_TIME: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00111001'),
        bias: 0,
        unit: 'start date(/time) of'
    },

    VIF_ACCUMULATION_IF_POSITIVE: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b00111011'),
        bias: 0,
        unit: 'Accumulation only if positive contribution'
    },

    VIF_DURATION_NO_EXCEEDS: {
        typeMask: b('0b01110111'),
        expMask: b('0b00000000'),
        type: b('0b01000001'),
        bias: 0,
        unit: '# of exceeds',
        calcFunc: valueCalcu
    },

    VIF_DURATION_LIMIT_EXCEEDED: {
        typeMask: b('0b01110000'),
        expMask: b('0b00000000'),
        type: b('0b01010000'),
        bias: 0,
        unit: 'duration of limit exceeded',
        calcFunc: valueCalcufnn
    },

    VIF_MULTIPLICATIVE_CORRECTION_FACTOR: {
        typeMask: b('0b01111000'),
        expMask: b('0b00000111'),
        type: b('0b01110000'),
        bias: -6,
        unit: ''
    },
    VIF_MULTIPLICATIVE_CORRECTION_FACTOR_1000: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01111101'),
        bias: 0,
        unit: '',
        calcFunc: valueCalcMultCorr1000
    },
    VIF_FUTURE_VALUE: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01111110'),
        bias: 0,
        unit: ''
    },
    VIF_MANUFACTURER_SPECIFIC: {
        typeMask: b('0b01111111'),
        expMask: b('0b00000000'),
        type: b('0b01111111'),
        bias: 0,
        unit: 'manufacturer specific'
    }
};

// For Easymeter (manufacturer specific)
var VIFInfo_ESY = {
    VIF_ELECTRIC_POWER_PHASE_NO: {
        typeMask: b('0b01111110'),
        expMask: b('0b00000000'),
        type: b('0b00101000'),
        bias: 0,
        unit: 'phase #',
        calcFunc: valueCalcNumeric
    },
    VIF_ELECTRIC_POWER_PHASE: {
        typeMask: b('0b01000000'),
        expMask: b('0b00000000'),
        type: b('0b00000000'),
        bias: -2,
        unit: 'W',
        calcFunc: valueCalcNumeric
    }
};


// see 4.2.3, page 24
var validDeviceTypes = {
    0x00: 'Other',
    0x01: 'Oil',
    0x02: 'Electricity',
    0x03: 'Gas',
    0x04: 'Heat',
    0x05: 'Steam',
    0x06: 'Warm Water (30 °C ... 90 °C)',
    0x07: 'Water',
    0x08: 'Heat Cost Allocator',
    0x09: 'Compressed Air',
    0x0a: 'Cooling load meter (Volume measured at return temperature: outlet)',
    0x0b: 'Cooling load meter (Volume measured at flow temperature: inlet)',
    0x0c: 'Heat (Volume measured at flow temperature: inlet)',
    0x0d: 'Heat / Cooling load meter',
    0x0e: 'Bus / System component',
    0x0f: 'Unknown Medium',
    0x10: 'Reserved for utility meter',
    0x11: 'Reserved for utility meter',
    0x12: 'Reserved for utility meter',
    0x13: 'Reserved for utility meter',
    0x14: 'Calorific value',
    0x15: 'Hot water (> 90 °C)',
    0x16: 'Cold water',
    0x17: 'Dual register (hot/cold) Water meter',
    0x18: 'Pressure',
    0x19: 'A/D Converter',
    0x1a: 'Smokedetector',
    0x1b: 'Room sensor (e.g. temperature or humidity)',
    0x1c: 'Gasdetector',
    0x1d: 'Reserved for sensors',
    0x1e: 'Reserved for sensors',
    0x1f: 'Reserved for sensors',
    0x20: 'Breaker (electricity)',
    0x21: 'Valve (gas)',
    0x22: 'Reserved for switching devices',
    0x23: 'Reserved for switching devices',
    0x24: 'Reserved for switching devices',
    0x25: 'Customer unit (Display device)',
    0x26: 'Reserved for customer units',
    0x27: 'Reserved for customer units',
    0x28: 'Waste water',
    0x29: 'Garbage',
    0x2a: 'Carbon dioxide',
    0x2b: 'Environmental meter',
    0x2c: 'Environmental meter',
    0x2d: 'Environmental meter',
    0x2e: 'Environmental meter',
    0x2f: 'Environmental meter',
    0x31: 'OMS MUC',
    0x32: 'OMS unidirectional repeater',
    0x33: 'OMS bidirectional repeater',
    0x37: 'Radio converter (Meter side)'
};

// bitfield, errors can be combined, see 4.2.3.2 on page 22
var validStates = {
    0x00: 'no errors',
    0x01: 'application busy',
    0x02: 'any application error',
    0x03: 'abnormal condition/alarm',
    0x04: 'battery low',
    0x08: 'permanent error',
    0x10: 'temporary error',
    0x20: 'specific to manufacturer',
    0x40: 'specific to manufacturer',
    0x80: 'specific to manufacturer'
};

//var encryptionModes = {
//    0x00: 'standard unsigned',
//    0x01: 'signed data telegram',
//    0x02: 'static telegram',
//    0x03: 'reserved',
//};

var encryptionModes = {
    0: "No encryption",
    1: "AES Counter Mode(AES - CTR)",
    5: "AES Cipher Block Chaining Mode(AES - CBC) with dynamicinitialization vector"
};

var functionFieldTypes = {
    0: 'Instantaneous value',
    1: 'Maximum value',
    2: 'Minimum value',
    3: 'Value during error state'
};


function manId2hex(idascii) {
    return (idascii.charCodeAt(1) - 64) << 10 | (idascii.charCodeAt(2) - 64) << 5 | (idascii.charCodeAt(3) - 64);
}

function manId2ascii (idhex) {
    //return String.fromCharCode((idhex >> 10) + 64) + String.fromCharCode(((idhex >> 5) & b('0b00011111')) + 64) + String.fromCharCode((idhex & b('0b00011111')) + 64);
    return String.fromCharCode((idhex >> 10) + 64) + String.fromCharCode(((idhex >> 5) & 0x1f) + 64) + String.fromCharCode((idhex & 0x1f) + 64);
}

function decodeBCD (digits, bcd) {
    var val = 0;
    for (var i = 0; i < digits / 2; i++) {
        var byte = bcd.charCodeAt(i);
        val += ((byte & 0x0f) + (((byte & 0xf0) >> 4) * 10)) * Math.pow(100, i);
    }
    return val;
}

function type2string (type) {
    return validDeviceTypes[type] || 'unknown';
}

function state2string (state) {
    var result = [];
    if (state) {
        for (var i in validStates) {
            //noinspection JSBitwiseOperatorUsage
            if (i & state) result.push(validStates[i]);
        }
    } else result.push(validStates[0]);
    return result;
}

function decNo(no, len) {
    var s = no.toString();
    if (len === undefined) len = 8;
    return '00000000'.substr(1, len - s.length) + s;
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var WMBUS = function (options) {
    if(!(this instanceof WMBUS)) return new WMBUS(options);
    this.msg = "";
    this.cw_parts = {};
    this.aesKey = {};
    this.crcRemoved = false;

    if (options) {
        if (options.log) app.log = options.log;
        if (options.formatDate) app.formatDate = options.formatDate;
    }
    this.cc = cc;
    this.crc_size = cc.CRC_SIZE;
};

WMBUS.prototype.setCrcSize = function (size) {
    this.crc_size = size;
}

WMBUS.prototype.getCrcSize = function (size) {
    return this.crc_size;
}


WMBUS.prototype.unpack = function (format, buf, obj) {
    if (format.indexOf('/') < 0) return unpackF(format + 'a/', buf).a;
    if (obj === undefined) obj = this;
    var ar = unpackF(format, buf);
    for (var i in ar) {
        obj[i] = ar[i];
    }
};

WMBUS.prototype.getAESKey = function (sn) {
    var ret = this.aesKey.hasOwnProperty('sn' + sn) ? this.aesKey['sn'+sn] : "";
    if (ret.length === 32) {
        ret = new Buffer(ret, 'hex');
    }
    return ret;
};

WMBUS.prototype.addAESKey = function (manufacturerId, key) {
    this.aesKey ['sn'+manufacturerId] = key || "";
};

WMBUS.prototype.hasAESKey = function () {
    return this.getAESKey(this.afield_id).length > 0;
};

WMBUS.prototype.removeCRC = function (msg) {
    var res = "";
    var _crc;
    var blocksize = cc.LL_BLOCK_SIZE;
    var blocksize_with_crc = cc.LL_BLOCK_SIZE + this.crc_size; //cc.CRC_SIZE;
    var crcoffset;

    var msgLen = this.datalen;                 // size without CRCs
    var noOfBlocks = this.datablocks;          // total number of data blocks, each with a CRC appended
    var rest = msgLen % cc.LL_BLOCK_SIZE;      // size of the last data block, can be smaller than 16 bytes

    // each block is 16 bytes + 2 bytes CRC

    app.log.debug("Length " + msgLen + " # blocks " + noOfBlocks + " remaining " + rest);
    if (this.crc_size === 0) return msg; //!!!!


    for (var i = 0; i < noOfBlocks; i++) {
        crcoffset = blocksize_with_crc * i + cc.LL_BLOCK_SIZE;
        app.log.debug(i + ': crc offset ' + crcoffset);
        if (rest > 0 && crcoffset + this.crc_size /*cc.CRC_SIZE*/ > (noOfBlocks - 1) * blocksize_with_crc + rest) {
            // last block is smaller
            crcoffset = (noOfBlocks - 1) * blocksize_with_crc + rest;
            app.log.debug('last crc offset ' + crcoffset);
            blocksize = msgLen - (i * blocksize);
        }

        //crc = ((msg.charCodeAt(crcoffset) & 0xFF) << 8) + (msg.charCodeAt(crcoffset + 1) & 0xFF);
        _crc = this.unpack('n', msg.substr(crcoffset, this.crc_size/*cc.CRC_SIZE*/));
        var __crc = crc.build(msg.substr(blocksize_with_crc * i, blocksize))

        app.log.debug(i + ': CRC ' + _crc.toString(16) + ', calc ' + __crc.toString(16) + 'blocksize ' + blocksize);
        //if (crc != this.checkCRC(msg.substr(blocksize_with_crc * i, blocksize))) {
        if (_crc !== __crc) {
            this.errormsg = "crc check failed for block " + i;
            this.errorcode = cc.ERR_CRC_FAILED;
            return 0;
        }
        res += msg.substr(blocksize_with_crc * i, blocksize);
    }
    return res;
};


WMBUS.prototype.decodeConfigword = function () {
    //#if (this.cw_parts.mode == 5) {
    this.cw_parts.bidirectional        = this.cw & 0x8000 >> 15; //b('0b1000000000000000') >> 15;
    this.cw_parts.accessability        = this.cw & 0x4000 >> 14; //b('0b0100000000000000') >> 14;
    this.cw_parts.synchronous          = this.cw & 0x2000 >> 13; //b('0b0010000000000000') >> 13;
    this.cw_parts.mode                 = this.cw & 0x0f00 >>  8; //b('0b0000111100000000') >> 8;
    this.cw_parts.encrypted_blocks     = this.cw & 0x00f0 >>  4; //b('0b0000000011110000') >> 4;
    this.cw_parts.content              = this.cw & 0x000c >>  2; //b('0b0000000000001100') >> 2;
    this.cw_parts.repeated_access      = this.cw & 0x0002 >>  1; //b('0b0000000000000010') >> 1;
    this.cw_parts.hops                 = this.cw & 0x0001;       //b('0b0000000000000001');
//#} else if (this.cw_parts.mode == 7) {
//# ToDo: wo kommt das dritte Byte her?
//#  this.cw_parts.mode = this.cw & b('0b0000111100000000') >> 8;
//#}
};


function findVIF(vif, vifInfoRef, dataBlockRef) {
    var bias;

    if (vifInfoRef !== undefined) {
        for (var vifType in vifInfoRef) {
            app.log.debug('vifType ' + vifType + ' VIF ' + vif + ' typeMask ' + vifInfoRef[vifType].typeMask + ' type ' + vifInfoRef[vifType].type);
            if ((vif & vifInfoRef[vifType].typeMask) == vifInfoRef[vifType].type) {
                app.log.debug('match vifType ' + vifType);
                bias = vifInfoRef[vifType].bias;
                dataBlockRef.exponent = vif & vifInfoRef[vifType].expMask;

                dataBlockRef.type = vifType;
                dataBlockRef.unit = vifInfoRef[vifType].unit;
                if (dataBlockRef.exponent != undefined && bias != undefined) {
                    dataBlockRef.valueFactor = Math.pow(10, (dataBlockRef.exponent + bias))
                } else {
                    dataBlockRef.valueFactor = 1;
                }
                dataBlockRef.calcFunc = vifInfoRef[vifType].calcFunc;

                app.log.debug('type ' + dataBlockRef.type + ' bias ' + bias + ' exp ' + dataBlockRef.exponent + ' valueFactor ' + dataBlockRef.valueFactor + ' unit ' + dataBlockRef.unit);
                return 1;
            }
        }
        app.log.debug("no match!");
        return 0;
    }
    return 1;
};

WMBUS.prototype.decodeValueInformationBlock = function (vib, dataBlockRef) {
    var offset = 0;
    var vif;
    var vifInfoRef;
    var vifExtension = 0;
    var vifExtNo = 0;
    var isExtension;
    var dataBlockExt;
    var VIFExtensions = [];
    var analyzeVIF = 1;

    dataBlockRef.type = '';
    // The unit and multiplier is taken from the table for primary VIF
    vifInfoRef = VIFInfo;

    EXTENSION:
        while (1) {
            vif = vib.charCodeAt(offset++);
            isExtension = vif & cc.VIF_EXTENSION_BIT;
            app.log.debug('vif: ' + vif.toString(16) + ' isExtension ' + isExtension);

            if (!isExtension) { //noinspection UnnecessaryLabelOnBreakStatementJS
                break EXTENSION;
            }

            vifExtNo++;
            if (vifExtNo > 10) {
                dataBlockRef.errormsg = 'too many VIFE';
                dataBlockRef.errorcode = cc.ERR_TOO_MANY_VIFE;
                break;
            }

            vifExtension = vif;
            vif &= ~cc.VIF_EXTENSION_BIT;
            app.log.debug('vif ohne extension: ' + vif.toString(16));
            switch (vif) {
                case 0x7D:
                    vifInfoRef = VIFInfo_FD;
                    break;
                case 0x7B:
                    vifInfoRef = VIFInfo_FB;
                    break;
                case 0x7C:
                    //# Plaintext VIF
                    var vifLength = vib.charCodeAt(offset++);
                    dataBlockRef.type = "see unit";
                    dataBlockRef.unit = this.unpack('C' + vifLength, vib.substr(offset, vifLength));
                    offset += vifLength;
                    analyzeVIF = 0;
                    break EXTENSION;
                case 0x7F:
                    if (this.manufacturer === 'ESY') {
                        // Easymeter
                        vif = vib.charCodeAt(offset++);
                        vifInfoRef = VIFInfo_ESY;
                    } else {
                        // manufacturer specific data, can't be interpreted
                        dataBlockRef.type = "MANUFACTURER SPECIFIC";
                        dataBlockRef.unit = "";
                        analyzeVIF = 0;
                    }
                    break EXTENSION;
                default:
                    // enhancement of VIFs other than $FD and $FB (see page 84ff.)
                    app.log.debug("other extension");
                    dataBlockExt = {};
                    if (this.manufacturer === 'ESY') {
                        vifInfoRef = VIFInfo_ESY;
                        dataBlockExt.value = vib.charCodeAt(2) * 100;
                    } else {
                        dataBlockExt.value = vif;
                        vifInfoRef = VIFInfo_other;
                    }

                    if (findVIF(vif, vifInfoRef, dataBlockExt)) {
                        VIFExtensions.push(dataBlockExt);
                    } else {
                        dataBlockRef.type = 'unknown';
                        dataBlockRef.errormsg = "unknown VIFE " + vifExtension.toString(16) + " at offset " + (offset - 1);
                        dataBlockRef.errorcode = cc.ERR_UNKNOWN_VIFE;
                    }
                    break;
            }
            if (!isExtension) break;
        }

    if (analyzeVIF) {
        if (findVIF(vif, vifInfoRef, dataBlockRef) == 0) {
            dataBlockRef.errormsg = "unknown VIF " + vifExtension.toString(16) + " at offset " + (offset - 1);
            dataBlockRef.errorcode = cc.ERR_UNKNOWN_VIFE;
        }
    }
    dataBlockRef.VIFExtensions = VIFExtensions;

    if (dataBlockRef.type === '') {
        dataBlockRef.type = 'unknown';
        dataBlockRef.errormsg = "in VIFExtension " + vifExtension.toString(16) + " unknown VIF " + vif.toString(16);
        dataBlockRef.errorcode = cc.ERR_UNKNOWN_VIF;
    }
    return offset;
};

WMBUS.prototype.decrypt = function (encrypted) {

    // see 4.2.5.3, page 26
    var initVector = this.msg.substr(2, 8);
    var iv_access_no = String.fromCharCode(this.access_no);
    for (var i = 1; i <= 8; i++) {
        initVector += iv_access_no;
    }
    var self = this;
    try {
    var ivBuf = new Buffer (initVector, 'binary');
    const decipher = crypto.createDecipheriv ('aes-128-cbc', this.getAESKey (this.afield_id), ivBuf, {});
    return decipher.update (encrypted, 'binary', 'binary');
    } catch(e) {
        self.errormsg = e.message;
        self.errorcode = cc.ERR_WRONG_AESKEY;
    }
    return '';
};

function decodeDataInformationBlock (dib, dataBlockRef) {
    var difExtNo = 0;
    var dif = dib.charCodeAt(0);
    var offset = 1;
    var isExtension = dif & cc.DIF_EXTENSION_BIT;

    dataBlockRef.tariff = 0;
    dataBlockRef.devUnit = 0;
    dataBlockRef.storageNo     = (dif & 0x0040) >> 6; // b('0b01000000')) >> 6;
    dataBlockRef.functionField = (dif & 0x0030) >> 4; //b('0b00110000')) >> 4;
    dataBlockRef.functionFieldText = functionFieldTypes[dataBlockRef.functionField];
    dataBlockRef.dataField     = dif & 0x000f;        // b('0b00001111');

    app.log.debug("dif " + dif.toString(16) + " storage " + dataBlockRef.storageNo);

    while (isExtension) {
        dif = dib.charCodeAt(offset);
        if (dif == undefined) break;
        offset++;
        isExtension = dif & cc.DIF_EXTENSION_BIT;
        difExtNo++;
        if (difExtNo > 10) {
            dataBlockRef.errormsg = 'too many DIFE';
            dataBlockRef.errorcode = cc.ERR_TOO_MANY_DIFE;
            //last EXTENSION;
            break;
        }

        dataBlockRef.storageNo |= (dif & 0x000f) << (difExtNo * 4) + 1;         //b('0b00001111')) << (difExtNo * 4) + 1;
        dataBlockRef.tariff    |= (dif & 0x0030 >> 4) << ((difExtNo - 1) * 2);  //b('0b00110000') >> 4)) << ((difExtNo - 1) * 2);
        dataBlockRef.devUnit   |= (dif & 0x0040 >> 6) << (difExtNo - 1);        //(dif & b('0b01000000') >> 6) << (difExtNo - 1);

        app.log.debug("dife " + dif.toString(16) + " extno " + difExtNo + " storage " + dataBlockRef.storageNo);
    }

    app.log.debug("in DIF: datafield " + dataBlockRef.dataField.toString(16));
    app.log.debug("offset in dif " + offset);

    return offset;
};

WMBUS.prototype.decodeDataRecordHeader = function (drh, dataBlockRef) {
    var offset = decodeDataInformationBlock(drh, dataBlockRef);
    offset += this.decodeValueInformationBlock(drh.substr(offset), dataBlockRef);
    app.log.debug("in DRH: type " + dataBlockRef.type);
    return offset;
};

WMBUS.prototype.decodePayload = function (payload) {
    var offset = 0, dataBlockNo = 0;
    var value;
    var dataBlocks = [];
    var dataBlock;

    PAYLOAD:
        while (offset < payload.length) {
            dataBlockNo++;

            //# create a new anonymous hash reference
            dataBlock = { number: dataBlockNo, unit: '' };
            //dataBlock.number = dataBlockNo;
            //dataBlock.unit = '';

            while (payload.charCodeAt(offset) == 0x2f) {
                app.log.debug("skipping filler at offset " + offset + ' of ' + payload.length);
                if (++offset >= payload.length) {
                    break PAYLOAD;
                }
            }

            offset += this.decodeDataRecordHeader(payload.substr(offset), dataBlock);
            app.log.debug("No. " + dataBlockNo + " type " + dataBlock.dataField.toString(16) + " at offset " + (offset - 1));

            switch (dataBlock.dataField) {
                case cc.DIF_NONE:
                    break;
                case cc.DIF_READOUT:
                    this.errormsg = "in datablock " + dataBlockNo + ": unexpected DIF_READOUT";
                    this.errorcode = cc.ERR_UNKNOWN_DATAFIELD;
                    return 0;
                case cc.DIF_BCD2:
                    value = decodeBCD(2, payload.substr(offset, 1));
                    offset += 1;
                    break;
                case cc.DIF_BCD4:
                    value = decodeBCD(4, payload.substr(offset, 2));
                    offset += 2;
                    break;
                case cc.DIF_BCD6:
                    value = decodeBCD(6, payload.substr(offset, 3));
                    offset += 3;
                    break;
                case cc.DIF_BCD8:
                    value = decodeBCD(8, payload.substr(offset, 4));
                    offset += 4;
                    break;
                case cc.DIF_BCD12:
                    value = decodeBCD(12, payload.substr(offset, 6));
                    offset += 6;
                    break;
                case cc.DIF_INT8:
                    value = this.unpack('C', payload.substr(offset, 1));
                    offset += 1;
                    break;
                case cc.DIF_INT16:
                    value = this.unpack('v', payload.substr(offset, 2));
                    offset += 2;
                    break;
                case cc.DIF_INT24:
                    value = this.unpack('V', payload.substr(offset, 3));  // use 32 bit formater with 3 bytes input
                    //var bytes = unpackF('Ca0/Ca1/Ca2/', payload.substr(offset, 3));
                    //value = bytes['a0'] + (bytes['a1'] << 8) + (bytes['a2'] << 16);
                    // With brackets, same result as above
                    offset += 3;
                    break;
                case cc.DIF_INT32:
                    value = this.unpack('V', payload.substr(offset, 4));
                    offset += 4;
                    break;
                case cc.DIF_INT48:
                    var words = unpackF('va0/va1/va2/', payload.substr(offset, 6));
                    value = words['a0'] + (words['a1'] << 16) + (words['a2'] << 32);
                    //value = (words['a0'] << 0) + (words['a1'] << 16) + (words['a2'] << 32);
                    offset += 6;
                    break;
                case cc.DIF_INT64:
                    var longs = unpackF('La0/La1/', payload.substr(offset, 8));
                    value = longs['a0'] + (longs['a1'] << 32);
                    //value = (longs['a0'] >>> 0) + ((longs['a1'] << 32) >>>0);
                    offset += 8;
                    break;
                case cc.DIF_FLOAT32:
                    //not allowed according to wmbus standard, Qundis seems to use it nevertheless
                    value = this.unpack('f', payload.substr(offset, 4));
                    offset += 4;
                    break;
                case cc.DIF_VARLEN:
                    var lvar = this.unpack('C', payload.substr(offset++, 1)) || 0;
                    app.log.debug("in datablock " + dataBlockNo + ": LVAR field " + lvar.toString(16));
                    app.log.debug("payload len " + payload.length + " offset " + offset);
                    if (lvar <= 0xbf) {
                        if (dataBlock.type === "MANUFACTURER SPECIFIC") {
                            // special handling, LSE seems to lie about this
                            value = this.unpack('H*', payload.substr(offset, lvar));
                            app.log.debug("VALUE: " + value);
                        } else {
                            //  ASCII string with LVAR characters
                            value = this.unpack('a*', payload.substr(offset, lvar));
                            if (this.manufacturer === 'ESY') {
                                // Easymeter stores the string backwards!
                                value = value.split('').reverse().join('');
                            }
                        }
                        offset += lvar;
                    } else if (lvar >= 0xc0 && lvar <= 0xcf) {
                        //  positive BCD number with (LVAR - C0h) â€¢ 2 digits
                        value = decodeBCD((lvar - 0xc0) * 2, payload.substr(offset, (lvar - 0xc0)));
                        offset += (lvar - 0xc0);
                    } else if (lvar >= 0xd0 && lvar <= 0xdf) {
                        //  negative BCD number with (LVAR - D0h) â€¢ 2 digits
                        value = -decodeBCD((lvar - 0xd0) * 2, payload.substr(offset, (lvar - 0xd0)));
                        offset += (lvar - 0xd0);
                    } else {
                        this.errormsg = "in datablock " + dataBlockNo + ": unhandled LVAR field " + lvar.toString(16);
                        this.errorcode = cc.ERR_UNKNOWN_LVAR;
                        return 0;
                    }
                    break;
                case cc.DIF_SPECIAL:
                    // special functions
                    app.log.debug("DIF_SPECIAL at" + offset);
                    value = this.unpack("H*", payload.substr(offset));
                    break PAYLOAD;
                default:
                    this.errormsg = "in datablock " + dataBlockNo + ": unhandled datafield " + dataBlock.dataField.toString(16);
                    this.errorcode = cc.ERR_UNKNOWN_DATAFIELD;
                    return 0;
            }

            if (dataBlock.calcFunc != undefined) {
                dataBlock.value = dataBlock.calcFunc(value, dataBlock);
                app.log.debug("Value raw " + value + " value calc " + dataBlock.value);
            } else if (value !== undefined) {
                dataBlock.value = value;
            } else {
                dataBlock.value = "";
            }

            var VIFExtensions = dataBlock.VIFExtensions;
            for (var i = 0; i < VIFExtensions.length; i++) {
                var VIFExtension = VIFExtensions[i];
                dataBlock.extension = VIFExtension.unit;
                if (VIFExtension.calcFunc != undefined) {
                    app.log.debug("Extension value " + VIFExtension.value + ", valueFactor " + VIFExtension.valueFactor);
                    dataBlock.extension += ", " + VIFExtension.calcFunc(VIFExtension.value, dataBlock);
                } else if (VIFExtension.value != undefined) {
                    dataBlock.extension += ", " + VIFExtension.value.toString(16);
                } else {
                    //$dataBlock->{extension} = "";
                }
            }
            value = undefined;

            dataBlocks.push(dataBlock)
        }

    this.datablocks = dataBlocks;
    return 1;
};


WMBUS.prototype.decodeApplicationLayer = function () {
    if (this.crcRemoved) {
        var applicationlayer = this.msg.substr(10);
    } else {
        var applicationlayer = this.removeCRC(this.msg.substr(cc.TL_BLOCK_SIZE + this.crc_size));
        if (this.errorcode != cc.ERR_NO_ERROR) {
            // CRC check failed
            return 0;
        }
    }

    app.log.debug(this.unpack("H*", applicationlayer));
    this.cifield = applicationlayer.charCodeAt(0);

    var offset = 1;

    switch (this.cifield) {
        case cc.CI_RESP_4:
            app.log.debug("short header");
            this.unpack('Caccess_no/Cstatus/ncw/', applicationlayer.substr(offset));
            offset += 4;
            break;
        case cc.CI_RESP_12:
            app.log.debug("Long header");
            this.unpack('Vmeter_id/vmeter_man/Cmeter_vers/Cmeter_dev/Caccess_no/Cstatus/ncw/', applicationlayer.substr(offset));

            this.meter_id = decNo(this.meter_id);
            this.meter_devtypestring = validDeviceTypes[this.meter_dev] || 'unknown';
            this.meter_manufacturer = uc(manId2ascii(this.meter_man));
            offset += 12;
            break;
        case cc.CI_RESP_0:
            // no header
            this.cw = 0;
            break;
        default:
            // unsupported
            this.cw = 0;
            this.decodeConfigword();
            this.errormsg = 'Unsupported CI Field ' + this.cifield.toString(16) + ", remaining payload is " + this.unpack("H*", applicationlayer.substr(offset));
            this.errorcode = cc.ERR_UNKNOWN_CIFIELD;
            return 0;
    }
    this.statusstring = state2string(this.status).join(", ");
    this.decodeConfigword();

    var payload;
    this.encryptionMode = encryptionModes[this.cw_parts.mode];
    switch (this.decrypted ? 0 : this.cw_parts.mode) {
        case 0: // no encryption
            this.isEncrypted = 0;
            this.decrypted = 1;
            payload = applicationlayer.substr(offset);
            break;

        case 5: // AES Cipher Block Chaining Mode(AES - CBC) with dynamicinitialization vector
            this.isEncrypted = 1;
            this.decrypted = 0;

            if (!this.hasAESKey()) {
                this.errormsg = 'encrypted message and no aeskey provided. Enter the aeskey in the settings.';
                this.errorcode = cc.ERR_NO_AESKEY;
                return 0;
            }
            payload = this.decrypt(applicationlayer.substr(offset));
            if (!payload && this.errorcode) return 0;
            if (this.unpack('n', payload) != 0x2f2f) {
                this.errormsg = 'Decryption failed, wrong key?';
                this.errorcode = cc.ERR_DECRYPTION_FAILED;
                var pl = this.unpack('n', payload);
                if (pl) app.log.debug(pl.toString(16));
                return 0;
            }
            this.decrypted = 1;
            app.log.debug("decrypted payload " + this.unpack("H*", payload));
            break;

        case 1: // AES Counter Mode(AES - CTR)

        default:
            // error, encryption mode not implemented
            this.errormsg = 'Encryption mode ' + this.cw_parts.mode.toString(16) + ' not implemented';
            this.errorcode = cc.ERR_UNKNOWN_ENCRYPTION;
            this.decrypted = 0;
            return 0;
    }
    return this.decodePayload(payload);
};


WMBUS.prototype.decodeLinkLayer = function (linklayer) {

    this.unpack('Clfield/Ccfield/vmfield/', linklayer);
    this.manufacturer = manId2ascii(this.mfield).toUpperCase();
    this.afield_id = decNo(decodeBCD(8, linklayer.substr(4, 4)));
    //this.unpack('Cafield_ver/Cafield_type/ncrc0/', linklayer.substr(8, 4));
    this.unpack('Cafield_ver/Cafield_type/', linklayer.substr(8, 2));

    app.log.debug("lfield " + this.lfield);

    if (!this.crcRemoved && this.crc_size > 0) {
        this.unpack('ncrc0/', linklayer.substr(cc.TL_BLOCK_SIZE, this.crc_size));
        //if (!this.crcRemoved) {
        var _crc0 = crc.build(linklayer.substr(0, cc.TL_BLOCK_SIZE));
        app.log.debug("crc0 " + (this.crc0 ? this.crc0.toString(16) : '') + " calc " + _crc0.toString(16));

        if (this.crc0 != _crc0) {
            this.errormsg = "CRC check failed on link layer";
            this.errorcode = cc.ERR_CRC_FAILED;
            app.log.debug("CRC check failed on link layer");
            return 0;
        }
    }

    // header block is 10 bytes + 2 bytes CRC, each following block is 16 bytes + 2 bytes CRC, the last block may be smaller
    this.datalen = this.lfield - (cc.TL_BLOCK_SIZE - 1); //this.datalen = this.lfield - 9; // this is without CRCs and the lfield itself
    this.datablocks = parseInt(this.datalen / cc.LL_BLOCK_SIZE);
    if (this.datalen % cc.LL_BLOCK_SIZE != 0) this.datablocks++;
    this.msglen = cc.TL_BLOCK_SIZE + this.crc_size + this.datalen + this.datablocks  * this.crc_size; // this.msglen = 12 + this.datalen + this.datablocks * cc.CRC_SIZE;

    app.log.debug("calc len " + this.msglen + ", actual " + this.msg.length);
    if (!this.crcRemoved) {
        if (this.msg.length > this.msglen) {
            this.remainingData = this.msg.substr(this.msglen);
        } else if (this.msg.length < this.msglen) {
            this.errormsg = "message too short, expected " + this.msglen + ", got " + this.msg.length + " bytes";
            this.errorcode = cc.ERR_MSG_TOO_SHORT;
            return 0;
        }
    }
    //# according to the MBus spec only upper case letters are allowed.
    //# some devices send lower case letters none the less
    //# convert to upper case to make them spec conformant
    this.manufacturer = manId2ascii(this.mfield).toUpperCase();
    this.typestring = validDeviceTypes[this.afield_type] || 'unknown';
    return 1;
};

WMBUS.prototype.parse = function (x) {
    var decrypted = this.decrypted;
    this.msg = x;
    this.errormsg = '';
    this.errorcode = cc.ERR_NO_ERROR;
    if (this.decodeLinkLayer(this.msg.substr(0, 12)) != 0) {
        this.linkLayerOk = 1;
        this.decodeApplicationLayer();
        this.updateStates();
    }
    this.decrypted = decrypted;
    return 0;
};


WMBUS.prototype.parseHex = function (x) {
    var data = '';
    x.match (/(..)/g).forEach (function (v) {
        data += String.fromCharCode (parseInt (v, 16));
    });
    return this.parse (data);
};


WMBUS.prototype.updateStates = function () {
    return false;
};

module.exports = WMBUS;

