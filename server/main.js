import { createServer } from './index.js'

const port = Number(process.env.PORT ?? 3000)
const { app } = await createServer()
app.listen(port, () => {
  console.log(`marina server on http://localhost:${port}`)
})