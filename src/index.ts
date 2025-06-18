import * as core from '@actions/core'
import WebSocket from 'ws'

async function run(): Promise<void> {
  try {
    const tuskUrl: string = core.getInput('tuskUrl', { required: true })
    const runId: string = core.getInput('runId', { required: true })

    // The backend's WebSocket endpoint is passed in tuskUrl, which already contains the full path.
    // e.g., wss://your-tusk-instance.com/ws/run/<run-id>
    const websocketUrl = new URL(tuskUrl)
    // The protocol is 'ws' for http and 'wss' for https.
    websocketUrl.protocol = websocketUrl.protocol.replace('http', 'ws')

    core.info(`Connecting to WebSocket endpoint: ${websocketUrl.toString()}`)

    const ws = new WebSocket(websocketUrl.toString())

    ws.on('open', () => {
      core.info('✅ WebSocket connection established. Awaiting instructions...')
    })

    ws.on('message', async (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString())
      core.info(`⬇️ Received message from backend: ${JSON.stringify(message)}`)

      // This is where you invoke lsproxy or other tools
      // For example, the backend sends: { command: 'get_definition', params: { file: '...', line: '...' } }
      const result = await runLspCommand(message.command, message.params)

      // Send the result back immediately
      core.info(`⬆️ Sending response to backend...`)
      ws.send(
        JSON.stringify({
          runId: runId,
          originalCommand: message.command,
          payload: result
        })
      )
    })

    ws.on('close', (code, reason) => {
      core.info(
        `🔌 WebSocket connection closed. Code: ${code}, Reason: ${reason.toString()}`
      )
      // The backend has finished sending commands, so this step can successfully exit.
    })

    ws.on('error', (error) => {
      // Fail the GitHub Action step if the connection errors out
      core.setFailed(`WebSocket error: ${error.message}`)
    })
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function runLspCommand(command: string, params: any): Promise<any> {
  // Placeholder for your actual logic to interact with lsproxy
  // You would use child_process.exec or a similar method here
  // to call your lsproxy client.
  core.info(
    `Executing LSP command: ${command} with params: ${JSON.stringify(params)}`
  )
  //
  // const { stdout } = await execAsync(`lsproxy-cli ${command} --params '${JSON.stringify(params)}'`);
  // return JSON.parse(stdout);
  //
  return { status: 'success', data: `result for ${command}` }
}

run()
