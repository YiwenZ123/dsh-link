import { WebSocket, WebSocketServer } from 'ws'

export function chooseWinner({ localDeviceId, remoteDeviceId, localDialed }) {
  const dialerId = localDialed ? localDeviceId : remoteDeviceId
  const smaller = localDeviceId < remoteDeviceId ? localDeviceId : remoteDeviceId
  if (dialerId === smaller) return localDialed ? 'local' : 'remote'
  return localDialed ? 'remote' : 'local'
}

export function dial({ host, port, timeoutMs = 8_000 }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${host}:${port}`)
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('地址不可达'))
    }, timeoutMs)
    socket.once('open', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      reject(new Error('地址不可达'))
    })
  })
}

export function listen(identity, onSocket) {
  const server = new WebSocketServer({ port: identity.listenPort || 0 })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', () => {
      server.on('connection', (socket, request) => onSocket(socket, request))
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}
