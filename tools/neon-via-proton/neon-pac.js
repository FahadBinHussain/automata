function FindProxyForURL(url, host) {
  if (host === 'neon.tech' || host.endsWith('.neon.tech')) {
    return 'SOCKS5 127.0.0.1:7891; DIRECT';
  }
  return 'DIRECT';
}
