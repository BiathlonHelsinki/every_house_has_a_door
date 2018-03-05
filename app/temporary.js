var request = require("request");
var fs = require('fs');
var sleep = require('sleep');
const Freefare = require('freefare/index');
var moment = require("moment");
var nfc  = require('nfc').nfc;
var util = require('util');
var weblock = require('lockfile');
var led = require("./rgb_led.js");
var yaml_config = require('node-yaml-config');
require('log-timestamp');
const http = require('http');
const config = yaml_config.load('./config/config.yml');
let backup = ''

function get_cached_keys() {

  let r = request.get({
    url: 'http://' + config.api + ":" + config.port + '/nfcs/all_keys',
    json: true,
    headers: {"X-Hardware-Name": config.name, "X-Hardware-Token": config.token}
  })
  .on('error', function (err) {
    console.log("Cannot connect to get cached keys: " + err)
  })
  .on('response', (res) => {
    res.pipe(fs.createWriteStream('keys.json'))
  })
  console.log('loading backup...')
  backup = JSON.parse(fs.readFileSync('./keys.json', 'utf8'));
}

console.log('starting up....')



async function unlock() { 
  console.log('removing lockfile if it exists')
  await weblock.unlock('webapi.lock')
}
unlock() 

get_cached_keys()

led.initRGB();
//
function Logger(){
}
function checkBin(n){return/^[01]{1,64}$/.test(n)}
function bin2hex(n){if(!checkBin(n))return 0;return parseInt(n,2).toString(16)}



Logger.prototype.plain = function(message){
 console.log(message);
}

Logger.prototype.log = function(message){
 var current_date = new Date();
 var str_date = moment(current_date).format("YYYY-MM-DD HH:mm Z");
 console.log(str_date + ": " + message);
}

var logger = new Logger();

function switch_relay(on){
 fs.writeFile("/sys/class/gpio/gpio2/value", on, function(err) {
 if(err) {
   return logger.log(err);
 }
   //logger.log("Relay has switched to: " + on);
 });
}

function toggle_relay(){
 switch_relay(1);
 setTimeout(function(){
   switch_relay(0);
 },1000);
}



function bip(on){
  if (fs.existsSync(config["clk_gpio"])) {
    fs.writeFile("/sys/class/gpio/gpio20/value", on, function (err) {
      if (err) {
        return logger.log(err);
      }
      //logger.log("Beep has switched to: " + on);
    });
  }
}

function toggle_bip(duration,callback){
 bip(1);
 setTimeout(function(){
   bip(0);
   if(callback){
     callback();
   }
 },duration);
}

function bip_read(callback){
 toggle_bip(200,callback);
}

function bip_success(callback){
 toggle_bip(600,callback);
}


function bip_error(callback){
 toggle_bip(300,function(){
   setTimeout(function(){
     toggle_bip(300, function(){
       setTimeout(function(){
         toggle_bip(300, callback);
       },100);
     });
   },100);
 });
}

function led_ready(){
 //Blue Led
 led.setColor(0x00,0x00,0x60);
}

function led_success(){
 //Blue Led
 led.setColor(0x00,0x60,0x00);
}

function led_error(){
 //Blue Led
 led.setColor(0xFF,0x00,0x00);
}


function led_waiting(){
 //Blue Led
 led.setColor(0xCC,0x4C,0x00);
}

function toggle_led(to,timeout){
 if(to == "success"){
     led_success();
 } else if(to == "error"){
     led_error();
 } else if(to == "waiting"){
     led_waiting();
 }
 setTimeout(function(){
     led_ready();
 },timeout);
}

function check_backup(tag_address, securekey) {
  return backup['data'].filter((item) => {
    return (item.attributes.security_code === securekey && item.attributes.tag_address === tag_address)
  })
}

var device = new nfc.NFC();
device.on('read', function(tag) {
  if ((!!tag.data) && (!!tag.offset))  {
    if (tag.type == 68) {
      var address = tag.data.toString('hex').substring(0,20);
      var security_code = tag.data.toString('hex').substring(32,40);
    } else if (tag.type == 4) {
      var address = tag.data.toString('hex').substring(0,8);
      var security_code = tag.data.toString('hex').substring(128,160);
    } else {
    	console.log('what the fuck this is ' + tag.type);
    	console.log('data is ' + tag.data.toString('hex'));
    }
    var url = 'http://' + config.api + ":" + config.port + '/nfcs/' + address + '/auth_door';
    weblock.check('webapi.lock', function(error, isLocked) {
      if (isLocked) {
        // console.log('not querying API again yet');
      } else {
        weblock.lock('webapi.lock', function(er) {

          console.log('-----')
          console.log('tag address is ' + address);
          request.get({url: url, 
  	                 json: true, timeout: 3000,
                     qs: {securekey: security_code },
                     headers: {"X-Hardware-Name": config.name, "X-Hardware-Token": config.token}
                   }, function (error, response, body) {
                        if (response) {
                    	    if (!error && response.statusCode === 200) {
                    	      console.log("Opened door for ", response.body.data.name);
                    	      if (response.body.data) {
                    		      switch_relay(1);
                              bip(0);
                              toggle_bip(500);
                              led_success();
                       		    setTimeout(function() {
                    		        switch_relay(0);
                    		      }, 4000);
                             } else {
                                bip_error();
                            }
                          }
                    	    else if (response.statusCode == 401) {
                            console.log('Unauthorised (check your headers and access tokens)');
                  	      } else {
                            console.log("Got an error: ", error, ", status code: ", response.statusCode);
                          }
                        } else {
                          console.log('cannot connect to API, checking backup here')
                          let is_allowed = check_backup(address, security_code)
                          if (is_allowed.length === 0) {
                            console.log('do not allow')
                            bip_error();
                          } else {
                            console.log('allow access for ' + is_allowed[0].attributes.holder_name)
                            switch_relay(1);
                            bip(0);
                            toggle_bip(500);
                            led_success();
                            setTimeout(function() {
                              switch_relay(0);
                            }, 4000); 
                          }
                        }   
                        setTimeout(function() {
                    	    weblock.unlock('webapi.lock', function(er) { });
                    	  }, 6000);
                      }
                    ).on('error', function(err) {
                        if (err.code === 'EHOSTDOWN' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT' || err.code === 'ECONNREFUSED') {
                          console.log('Host was down, used backup ')
                        } else {
                          console.log('unknown error: ' + util.inspect(err))
                        }
                      })
  	    })
      }
    })
  }
}).on('error', function(err) {
  console.log('THIS SHOULD RESTART OR REBOOT OR SOMETHING')
}).start()
	

bip(0);
led_error();

