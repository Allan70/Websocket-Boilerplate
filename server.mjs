import { createServer } from 'http'
import crypto from 'crypto'

const PORT = 3001;
const WEBSOCKET_MAGIC_STRING_KEY = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const SEVEN_BITS_INTEGER_MARKER = 125;
const SIXTEEN_BITS_INTEGER_MARKER = 126;
const SIXTYFOUR_BITS_INTEGER_MARKER = 127;

const MAXIMUM_SIXTEENBITS_INTEGER = 2 ** 16; // 0 to 65536
const MASK_KEY_BYTES_LENGTH = 4;
const OPCODE_TEXT = 0x01;
//parseInt('10000000', 2)
const FIRST_BIT = 128;

const server = createServer((request, response)=>{
    response.writeHead(200);
    response.end('Hello word, fuck you!')
})

server.listen(PORT, ()=>{
    console.log(`Server listening at http://localhost:${PORT}`);
})


server.on('upgrade', onSocketUpgrade)

function onSocketUpgrade(req, socket, head){
    const {'sec-websocket-key' : webClientSocketKey} = req.headers
    console.log(`${webClientSocketKey} connected!`)
    const headers = prepareHandShakeHeaders(webClientSocketKey);
    console.log({headers})

    socket.write(headers);
    socket.on('readable', ()=>onSocketReadable(socket))
}

function sendMessage(msg, socket){
    const dataFrameBuffer = prepareMessage(msg);   
    socket.write(dataFrameBuffer);
}

function prepareMessage(message){
    const msg = Buffer.from(message)
    const messageSize = msg.length;

    let dataFrameBuffer;
    let offset = 2;

    // 0x80 === 128 in binary
    //'0x' + Math.abs(128).toString(16)
    const firstByte = 0x80 | OPCODE_TEXT;
    if(messageSize <= SEVEN_BITS_INTEGER_MARKER )
    {
        const bytes = [firstByte]
        dataFrameBuffer = Buffer.from(bytes.concat(messageSize))
    }
    else if(messageSize <= MAXIMUM_SIXTEENBITS_INTEGER )
    {
        const offsetFourBytes = 4;
        const target = Buffer.allocUnsafe(offsetFourBytes)
        target[0] = firstByte
        target[1] = SIXTEEN_BITS_INTEGER_MARKER | 0x0 //Just to know the mask

        target.writeUInt16BE(messageSize, 2); // content length is 2 bytes
        dataFrameBuffer = target   
        
        //alloc 4 bytes
        //[0] - 128 + 1 - 10000001 = 0x81 fin + opcode
        //[1] - 126 + 0 - payload length marker + mask indicator
        //[2] 0 - content length
        //[3] 171 - content length
        //[4 - ...] - the message itself
        
    }
    else{
        throw new Error('message too long buddy :(');
    }

    const totalLength =  dataFrameBuffer.byteLength + messageSize
    const dataFrameResponse = concat([dataFrameBuffer, msg], totalLength)
    return dataFrameResponse;
}

function concat(bufferList, totalLength)
{
    const target = Buffer.allocUnsafe(totalLength)
    let offset = 0;
    for(const buffer of bufferList)
    {
        target.set(buffer, offset);
        offset += buffer.length
    }

    return target;
}

function onSocketReadable(socket){
    // Consume optcode (first byte) 
    //Read 1 Byte - 8 bits
    socket.read(1);  

    // check if '10000000' mask bit is present
    const [ markerAndPayloadLength ] = socket.read(1);
    //The first bit is always 1 for clent-to-server messages
    // Subtract 1 bit or '10000000' from this byte to get rid of the 
    // first bit

    const lengthIndicatorInBits = markerAndPayloadLength - FIRST_BIT;

    let messageLength = 0;
    if(lengthIndicatorInBits <= SEVEN_BITS_INTEGER_MARKER)
    {
        messageLength = lengthIndicatorInBits
    }
    else if(lengthIndicatorInBits === SIXTEEN_BITS_INTEGER_MARKER){
        //unsigned, big-edian 16-bit integer (0 - 65k) - 2 ** 16
        messageLength = socket.read(2).readUInt16BE(0);
   
    }
    else{
        throw new Error(`Your message is too long we don't handle 64bit messages`)
    }

    const maskKey = socket.read(MASK_KEY_BYTES_LENGTH);
    const encoded = socket.read(messageLength);
    const decoded = unmask(encoded, maskKey);

    const data = JSON.parse(decoded.toString('utf8'));
    console.log('message received: ', data)

    const msg = JSON.stringify({
        message: data, 
        at: new Date().toISOString()
    }) 
    sendMessage(msg, socket);
}

function unmask(encodedBuffer, maskKey){
    const finalBuffer = Buffer.from(encodedBuffer)
    // Because the Mask Kye has only 4 bytes we do 
    // index % 4 === 0, 1, 2, 3 = index bits needed to decode the message

    //XOR ^
    //Returns 1 of both are different
    //Returns 0 if both are equal

    //(71).toString(2).padStart(8, "0") = '0 1 0 0 0 1 1 1'
    //(53).toString(2).padStart(8, "0") = '0 0 1 1 0 1 0 1'

    //                                    '0 1 1 1 0 0 1 0'
    //String.fromCharCode(parseInt('01110010', 2))
    //(71 ^ 53).toString(2).padStart(8, "0")
    const filledWithEightZeros = (t)=> t.padStart(8, "0")
    const toBinary = (t)=> filledWithEightZeros(t.toString(2))
    const fromBinaryToDecimal = (t)=> parseInt(toBinary(t), 2)
    const getCharFromBinary = (t)=> String.fromCharCode(fromBinaryToDecimal(t))

    for(let index = 0 ; index < encodedBuffer.length; index++)
    {
        finalBuffer[index] = encodedBuffer[index] ^ maskKey[index % MASK_KEY_BYTES_LENGTH];
        const logger = {
            unmaskingCalc : `${toBinary(encodedBuffer[index])} ^ ${toBinary(maskKey[index % MASK_KEY_BYTES_LENGTH])} =  ${toBinary(finalBuffer[index])}`,
            decoded :  getCharFromBinary(finalBuffer[index])
        }

        console.log(logger)
    }

    return finalBuffer;  
}

function prepareHandShakeHeaders(id){
    const acceptKey = createSocketAccept(id)
    const headers = [
        'HTTP/1.1 101 Switching Protocol',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-Websocket-Accept: ${acceptKey}`,
        ''
    ].map(line => line.concat('\r\n')).join('')

    return headers;
}

function createSocketAccept(id){
    const shaum = crypto.createHash('sha1')
    shaum.update(id + WEBSOCKET_MAGIC_STRING_KEY)
    return shaum.digest('base64');
}


//Error handling to keep the server on
;
[
    "uncaughtException", 
    "unhandledRejection"
].forEach(event => process.on(event, (err)=>{
    console.error(`Something bad happened! event: ${event}, msg: ${err.stack || err}`)
}));
