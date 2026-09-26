export function panelModel(snapshot) {
  return {
    title: '设备',
    sections: [
      {
        id: 'local',
        displayName: snapshot.local.displayName,
        shortId: snapshot.local.deviceId.slice(0, 8),
        port: snapshot.local.port,
        discoverable: snapshot.local.discoverable,
      },
      { id: 'peers', rows: snapshot.peers },
      { id: 'nearby', rows: snapshot.nearby },
      { id: 'manual' },
    ],
  }
}
