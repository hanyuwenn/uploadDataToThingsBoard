const BAUD_RATE = 38400;
const DATA_BITS = 8;
const STOP_BITS = 1;
const PORT_PATH = 'com3';
const HOST 		= '211.95.2.67';
const BUFF_SIZE = 10;

const ACCELEROMETER_TYPE = 2;
const ELECTRICRESISTANCESTRAIN_TYPE = 32;
const TEMPERATURE_TYPE = 1;
// 读取配置文件·
var fs = require('fs');
var idTokenMap = new Map();
fs.readFile('id-token-map', 'utf8', function (err,data) {
  if (err) {
    return //////console.log(err);
  }
  var idTokenMapStrs = data.split("\r\n");
  for (var i = 0; i < idTokenMapStrs.length; i++) {
  	var idTokenMapStr = idTokenMapStrs[i].split(" ");
  	idTokenMap.set(idTokenMapStr[0], idTokenMapStr[1]);
  }
  //////console.log(idTokenMap);
  startListern();
});

// 打开串口监听数据
function startListern() {
	var SerialPort = require('serialport');	// 加载serialport模块
	// 配置串口
	var port = new SerialPort(PORT_PATH, {
		baudRate: BAUD_RATE,
		dataBits: DATA_BITS,
		stopBits: STOP_BITS
	});
	const ByteLength = SerialPort.parsers.ByteLength;
	const parser = port.pipe(new ByteLength({length: 13}));
	
	// 配置服务器端地址
	var	host = HOST;

	// 用于缓存每个设备检测到的数据，key = id + type, value = 每个设备检测的数据的数组 
	var deviceDataMap = new Map();

	var tempNum = 0;
	
	// 打开串口监听数据
	parser.on('data', function(primaryData) {
		//////console.log(primaryData);

		var data = new Data(primaryData);			// 初步解析原始数据
		var type = bytes2Int16(data.sensorType);	// 获取上传数据的设备的类型
		//////console.log(type);
		
		// 根据传感器类型创建对应的对象、并做对应的处理
		var device;
		if (type == ACCELEROMETER_TYPE) {
			device = new Accelerometer();	
		}
		else if (type == ELECTRICRESISTANCESTRAIN_TYPE) {
			device = new ElectricResistanceStrain();
		}
		else if (type == TEMPERATURE_TYPE) {
			if (tempNum < 1) {
				tempNum++;
				return;
			}
			tempNum = 0;
			device = new Temperature();
		}
		else return;
		device.parseData(data);											   // 解析数据
		var dataArr = deviceDataMap.get(device.attributes.id + '' +  type);    // 获取数据缓冲数组
		
		if(dataArr == null) {
			dataArr = new Array();
			deviceDataMap.set(device.attributes.id + '' +  type, dataArr);
		}
		dataArr.push(device);													// 将解析完成的数据放入数据缓冲池中
		if(type == TEMPERATURE_TYPE || dataArr.length >= BUFF_SIZE) {										// 当缓冲数据达到设定值时，上传数据
			//////console.log(device.attributes.id + '' +  type);
			var token = idTokenMap.get(device.attributes.id + '' +  type);		// 获得当前设备在服务器端的token
			if (token == null) return;
			var telemetryData = device.uploadTelemetry(dataArr);				// 将缓冲池中的数据解析成上传数据的格式
			//////console.log(JSON.stringify(device.telemetry));
			//////console.log(telemetryData);
			uploadData(host, token, JSON.stringify(device.attributes), JSON.stringify(telemetryData));	// 上传数据
			//////console.log(type);
		}
	});
}

function Data(primaryData) {	// 初步解析从串口监听到的数据
	var data = {
		header: primaryData.slice(0, 2),
		mcuId:primaryData.slice(2, 4),
		sensorType:primaryData.slice(4, 6),
		payLoad:primaryData.slice(6, 12),
		chk:primaryData.slice(12, 13),
	}
	return data;
}

function bytes2Int32(bytes) {	// byte类型的数组转成32位的整型
	var int32 = 0;
	for (var i = 0; i < 4; i++) {
		int32 = int32 << 8;
		int32 = int32 | (bytes[i] & 0xFF);
	}
	return int32;
}

function bytes2Int16(bytes) {	// byte类型的数组转成16位的数字
	var int16 = new Int16Array(1);
	int16[0] = 0;
	for (var i = 0; i < 2; i++) {
		int16[0] <<= 8;
		int16[0] += bytes[i];
	}
	return int16[0];
}

function Accelerometer() {		// 加速度器的构造函数
	var accelerometer = {
		telemetry: {			// 检测到的数据
			x: 0, 
			y: 0, 
			z: 0,
		},
		attributes: {			// 设备属性
		},
		parseData:function parseData(data) {	// 解析数据
			this.telemetry.x = bytes2Int16(data.payLoad.slice(0, 2)) / 16834.0;
			this.telemetry.y = bytes2Int16(data.payLoad.slice(2, 4)) / 16834.0;
			this.telemetry.z = bytes2Int16(data.payLoad.slice(4, 6)) / 16834.0;
			this.attributes.id = bytes2Int16(data.mcuId);
		},
		uploadTelemetry:function uploadTelemetry(accelerometers) {	// 上传数据时调用的函数， 参数：Accelerometer类型的数组，返回值：Accelerometer数组的数据拼成的用于上传数据的字符串
			if (accelerometers.length < 1) return;
			var upTelemetry = {
					x:'' + accelerometers[0].telemetry.x,
					y:'' + accelerometers[0].telemetry.y,
					z:'' + accelerometers[0].telemetry.z,
				};
			accelerometers.shift();
			while(accelerometers.length > 0){
				var accelerometer = accelerometers.shift();
				upTelemetry.x += ',' + accelerometer.telemetry.x;
				upTelemetry.y += ',' + accelerometer.telemetry.y;
				upTelemetry.z += ',' + accelerometer.telemetry.z;
			}
			return upTelemetry;
		}
	};
	return accelerometer;
}

function ElectricResistanceStrain() {
	var electricResistanceStrain = {
		telemetry: {
			strain: 0,
		},
		attributes: {
		},
		parseData:function parseData(data) {
			var st = bytes2Int32(data.payLoad);
			this.telemetry.strain = (1 / (2.048 * st / 3.3 / Math.pow(2, 23) + 1) - 1) * Math.pow(10, 6);
			this.attributes.id = bytes2Int16(data.mcuId);
		},
		uploadTelemetry:function uploadTelemetry(electricResistanceStrains) {
			if (electricResistanceStrains.length < 1) return;
			var upTelemetry = {
				strain:'' + electricResistanceStrains[0].telemetry.strain,
			};
			electricResistanceStrains.shift();
			while(electricResistanceStrains.length > 0){
				var electricResistanceStrain = electricResistanceStrains.shift();
				upTelemetry.strain += ',' + electricResistanceStrain.telemetry.strain;
			}
			return upTelemetry;
		}
	};
	return electricResistanceStrain;
}

function Temperature() {
	var temperature = {
		telemetry: {
			temperature: 0,
		},
		attributes: {
		},
		parseData:function parseData(data) {
			var n = bytes2Int32(data.payLoad);
			var k = n / Math.pow(2, 25) * 2.048 / 2.7;
			this.telemetry.temperature = (240 / (1 - 2 * k) - 220) * 50 / 19.4 - 7;
			//////console.log(this.telemetry.temperature);
			this.attributes.id = bytes2Int16(data.mcuId);
		},
		uploadTelemetry:function uploadTelemetry(temperatures) {
			if (temperatures.length < 1) return;
			var upTelemetry = {
				temperature:'' + temperatures[0].telemetry.temperature,
			};
			temperatures.shift();
			while(temperatures.length > 0){
				var temperature = temperatures.shift();
				upTelemetry.temperature += ',' + temperature.telemetry.temperature;
			}
			return upTelemetry;
		}
	};
	return temperature;
}

function uploadData(host, token, attribute, telemetry) {	// 上传数据
	var mqtt = require('mqtt');
	//////console.log('Connecting to: %s using access token: %s', host, token);
	 
	var client  = mqtt.connect('mqtt://'+ host, {
	    username: token
	});

	client.on('connect', function () {
	    //////console.log('Client connected!');
	    client.publish('v1/devices/me/attributes', attribute);
	    //////console.log('Attributes published!');
	    client.publish('v1/devices/me/telemetry', telemetry);
	    //////console.log('Telemetry published!' + telemetry);
	    client.end();
	});
}