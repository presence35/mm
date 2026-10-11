/*
 * Test-only listener. Sandboxes differ in which TCP binds they allow:
 * GoDaddy's build container denies the wildcard address, then loopback.
 * So boot tries a short chain and uses the first bind that works, reporting
 * the real base URL. TEST_PORT/TEST_HOST opt into a platform-assigned target.
 *
 * If nothing binds, it throws one descriptive error instead of dozens of
 * cryptic EACCES lines — that message is the diagnosis the host needs.
 */

function tryListen(app, port, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host)
    server.once('listening', () => resolve(server))
    server.once('error', (err) => {
      server.close(() => {})
      reject(err)
    })
  })
}

export async function listenTest(app) {
  const attempts = []
  if (process.env.TEST_PORT) {
    attempts.push({ port: Number(process.env.TEST_PORT), host: process.env.TEST_HOST || '127.0.0.1' })
  }
  attempts.push({ port: 0, host: '127.0.0.1' }, { port: 0, host: '::1' })

  const denied = []
  for (const { port, host } of attempts) {
    try {
      const server = await tryListen(app, port, host)
      const addr = server.address()
      const hostPart = addr.address.includes(':') ? `[${addr.address}]` : addr.address
      return { server, base: `http://${hostPart}:${addr.port}` }
    } catch (err) {
      denied.push(`${host}:${port} (${err?.code ?? err?.message})`)
    }
  }
  throw new Error(
    `test sandbox forbids TCP binds (tried ${denied.join(', ')}). ` +
    `Run the non-network unit subset on this host instead.`,
  )
}
