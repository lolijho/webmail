import net from 'net';
import dnsp from 'dns/promises';

// Raw TCP reachability probe: does the container's network allow us to open a
// socket to host:port? Reports DNS records and connection timing so the user
// can tell a firewall/timeout apart from a wrong host or bad credentials.
export async function probe(host, port, timeoutMs = 8000) {
  const result = { host, port, dns: {}, tcp: null };

  const [ipv4, ipv6] = await Promise.all([
    dnsp.resolve4(host).catch(() => []),
    dnsp.resolve6(host).catch(() => []),
  ]);
  result.dns = { ipv4, ipv6 };

  result.tcp = await tcpProbe(host, port, timeoutMs);
  return result;
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let remoteAddress = null;
    let done = false;

    const sock = net.connect({ host, port });
    sock.setTimeout(timeoutMs);

    const finish = (ok, error) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ ok, ms: Date.now() - t0, error: error || null, remoteAddress });
    };

    sock.once('connect', () => {
      remoteAddress = sock.remoteAddress || null;
      finish(true);
    });
    sock.once('timeout', () => finish(false, 'timeout'));
    sock.once('error', (e) => finish(false, e.code || e.message));
  });
}
