import * as core from '@actions/core'
import WebSocket from 'ws'

async function run(): Promise<void> {
  try {
    const tuskUrl: string = core.getInput('tuskUrl', { required: true })
    const runId: string = core.getInput('runId', { required: true })

    const url = new URL(tuskUrl)
    const websocketUrl = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws/sandbox`

    core.info(`Connecting to WebSocket endpoint: ${websocketUrl}`)

    const ws = new WebSocket(websocketUrl)

    ws.on('open', () => {
      core.info('✅ WebSocket connection established. Sending auth message...')
      // Immediately send the authentication message with the runId
      ws.send(
        JSON.stringify({
          type: 'auth',
          runId: runId
        })
      )
      core.info('✅ Auth message sent. Awaiting instructions...')
    })

    ws.on('message', async (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString())
      core.info(`⬇️ Received message from backend: ${JSON.stringify(message)}`)

      // This is where you invoke lsproxy or other tools
      const result = await runLspCommand(message.command, message.params)

      // Send the result back immediately
      core.info(`⬆️ Sending response to backend...`)
      ws.send(
        JSON.stringify({
          originalCommand: message.command,
          payload: result
        })
      )
    })

    ws.on('close', (code, reason) => {
      core.info(
        `🔌 WebSocket connection closed. Code: ${code}, Reason: ${reason.toString()}`
      )
      if (code !== 1000) {
        // A non-1000 code might indicate an issue.
        core.setFailed(`WebSocket closed with non-standard code: ${code}`)
      }
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
  core.info(
    `Executing LSP command: ${command} with params: ${JSON.stringify(params)}`
  )
  // Placeholder for your actual logic to interact with lsproxy
  return { status: 'success', data: `result for ${command}` }
}

run()
