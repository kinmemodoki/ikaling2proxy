const config  = require('./config.json');
const request = require('request');
const https      = require('https');
const httpProxy = require('http-proxy');
const fs = require('fs');

const ssl_server_key = 'ssl/splat_key.pem';
const ssl_server_crt = 'ssl/splat_cert.pem';
const ssl_client_crt = 'ssl/client_cert.pem';

function httpRequest(options) {
  return new Promise(function (resolve, reject) {
    request(options, function (error, res, body) {
      if (!error && res.statusCode == 200) {
        body['res'] = res;
        resolve(res);
      } else {
        reject(error);
      }
    });
  });
}

async function getAccessToken(){
  var client_id = config.client_id;
  var resource_id = config.resource_id;
  var init_session_token = config.init_session_token;

  var apiTokenRes = await httpRequest({
    url: 'https://accounts.nintendo.com/connect/1.0.0/api/token',
    method: 'POST',
    headers: {'Accept': 'application/json'},
    json:{
      'client_id': client_id,
      'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token',
      'session_token': init_session_token
    }
  });
  var apiToken = apiTokenRes['body'];

  var someTokensRes = await httpRequest({
    url: 'https://api-lp1.znc.srv.nintendo.net/v1/Account/GetToken',
    method: 'POST',
    headers: {'Accept': 'application/json',
      'Authorization': 'Bearer ' + apiToken['access_token']},
    json:{"parameter": {
      "language": "null",
      "naBirthday": "null",
      "naCountry": "null",
      "naIdToken": apiToken["id_token"]}
    }
  });
  var tokens = someTokensRes['body']['result'];

  var authRes = await httpRequest({
    url: "https://api-lp1.znc.srv.nintendo.net/v1/Game/GetWebServiceToken",
    method: 'POST',
    headers: {"Accept": "application/json",
      "Authorization": "Bearer "+tokens["webApiServerCredential"]["accessToken"]},
    json:{"parameter": {"id": resource_id}}
  });

  if(authRes['body'].status != 0){
    return new Promise(function (resolve, reject) {
      reject('Nintendo Account Auth Error!!');
    });
  }

  var accessToken = authRes['body']["result"]["accessToken"]

  var session = await httpRequest({
    url: "https://app.splatoon2.nintendo.net/?lang=ja-JP",
    method: 'GET',
    headers: {"Accept": "application/json",
      "X-gamewebtoken": accessToken}
  });

  var session_id = session.caseless.dict['set-cookie'][0].split(';')[0].split('=')[1];
  
  return new Promise(function (resolve, reject) {
    resolve(accessToken);
  });
}

var isAuthorized = true;
var proxy = httpProxy.createServer();

https.createServer( {
  key: fs.readFileSync(ssl_server_key,'utf8'),
  cert: fs.readFileSync(ssl_server_crt,'utf8'),
  ca: fs.readFileSync(ssl_client_crt,'utf8'),
  requestCert: true, 
  rejectUnauthorized: true
},async function (req, res) {
  if(isAuthorized){
    proxy.web(req, res, {
      changeOrigin: true,
      port: 443,
      https: true,
      target: 'https://app.splatoon2.nintendo.net'
    });
  }else{
    var accessToken = await getAccessToken();
    proxy.web(req, res, {
      changeOrigin: true,
      port: 443,
      https: true,
      target: 'https://app.splatoon2.nintendo.net',
      headers: {"Accept": "application/json","X-gamewebtoken": accessToken}
    });
  }
}).listen(4430);

proxy.on('proxyRes', function (proxyRes, req, res) {
  if(proxyRes.statusCode==403){
    console.log('Not Authorized!! At ',new Date());
    isAuthorized = false;
  }else{
    isAuthorized = true;
  }
});

