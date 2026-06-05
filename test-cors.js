const http = require('https');
const options = {
  hostname: 'oss-collab.excalidraw.com',
  port: 443,
  path: '/socket.io/?EIO=4&transport=polling',
  method: 'GET',
  headers: {
    'Origin': 'https://drawing-nctb.vercel.app'
  }
};
const req = http.request(options, res => {
  console.log('statusCode:', res.statusCode);
  console.log('headers:', res.headers);
});
req.on('error', e => {
  console.error(e);
});
req.end();
