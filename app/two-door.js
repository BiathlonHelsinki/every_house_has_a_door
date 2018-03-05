var request = require("request");
var fs = require('fs');
var sleep = require('sleep');
const Freefare = require('freefare/index');
var moment = require("moment");
var nfc  = require('nfc').nfc;
var util = require('util');
var weblock = require('lockfile');
// var led = require("./rgb_led.js");
var yaml_config = require('node-yaml-config');
require('log-timestamp');
 
var config = yaml_config.load('./config/config.yml');
 





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

function switch_relay(on, side) {
  if (side == 'closet') {
    fs.writeFile("/sys/class/gpio/gpio2/value", on, function(err) {
      if(err) {
        return logger.log(err);
      }
    });
  } else if (side == 'rental') {
    fs.writeFile("/sys/class/gpio/gpio67/value", on, function(err) {
      if(err) {
        return logger.log(err);
      }
    });     
  }   
}

function toggle_relay(side){
 switch_relay(1, side);
 setTimeout(function(){
   switch_relay(0, side);
 },1000);
}


function clear_all_leds() {
  fs.writeFile("/sys/class/gpio/gpio66/value", 0, function(err) {
    if(err) {
      return logger.log(err);
    }
  });
  fs.writeFile("/sys/class/gpio/gpio69/value", 0, function(err) {
    if(err) {
      return logger.log(err);
    }
  });
  fs.writeFile("/sys/class/gpio/gpio68/value", 0, function(err) {
    if(err) {
      return logger.log(err);
    }
  });
  fs.writeFile("/sys/class/gpio/gpio75/value", 0, function(err) {
    if(err) {
      return logger.log(err);
    }
  });
}
function toggle_led(side, colour) {
  
  if ((side == 'rental') && (colour == 'red')) {
    fs.writeFile("/sys/class/gpio/gpio66/value", 1, function(err) {
      if(err) {
        return logger.log(err);
      }
    });   
  
  } else if ((side == 'rental') && (colour == 'green')) {
    fs.writeFile("/sys/class/gpio/gpio75/value", 1, function(err) {
      if(err) {
        return logger.log(err);
      }
    });
    
  } else if ((side == 'closet') && (colour == 'red')) {
    fs.writeFile("/sys/class/gpio/gpio68/value", 1, function(err) {
      if(err) {
        return logger.log(err);
      }
    });    
  } else if ((side == 'closet') && (colour == 'green')) {
    fs.writeFile("/sys/class/gpio/gpio69/value", 1, function(err) {
      if(err) {
        return logger.log(err);
      }
    });   
 }
  setTimeout(function(){
    clear_all_leds();
  }, 4000);
}

weblock.unlock('webapi.lock', function(er) { });
clear_all_leds();

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
    var url = 'http://' + config.api + ":" + config.port + '/nfcs/' + address + '/auth_closet';


    //    console.log('would query ' + url);
  weblock.check('webapi.lock', function(error, isLocked) {
    if (isLocked) {
      console.log('not querying API again yet');
    } else {
      weblock.lock('webapi.lock', function(er) {

         console.log('-----')
         console.log('tag address is ' + address);
        request.get({url: url, 
	  json: true,
          qs: {securekey: security_code },
          headers: {"X-Hardware-Name": config.name, "X-Hardware-Token": config.token}},
	  function (error, response, body) {
	    if (!error && response.statusCode === 200) {
              if (response.body.data.access == 'RENTAL') {
   	        console.log("Opened rental room for ", response.body.data.user.name);
		switch_relay(1, 'rental');
		toggle_led('rental', 'green');
		toggle_led('closet', 'red');
		setTimeout(function() {
                  switch_relay(0, 'rental');
                }, 4000);
              } else if (response.body.data.access == 'BOTH') { console.log("Opened both doors for ", response.body.data.user.name);
	      }
	      if (response.body.data) {
		      switch_relay(1, 'rental');
		      switch_relay(1, 'closet');
	        toggle_led('rental', 'green');
		toggle_led('closet', 'green');

   		setTimeout(function() {
		  switch_relay(0, 'rental');
		  switch_relay(0, 'closet');
		}, 4000);
               }
            } else {

	      if (response.statusCode == 401) {
               console.log('Unauthorised (check your headers and access tokens)', response.body.error.message);
		toggle_led('rental', 'red');
		toggle_led('closet', 'red');
	      } else {
                console.log("Got an error: ", error, ", status code: ", response.statusCode);
                toggle_led('rental', 'red');
                toggle_led('closet', 'red');
              }
            }   
            setTimeout(function() {
	      weblock.unlock('webapi.lock', function(er) { });
	    }, 6000);


          });
	});
     }
   });

  }
}).on('error', function(err) {
    // handle background error;
}).start();

	


