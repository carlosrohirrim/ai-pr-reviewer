import './fetch-polyfill'

import {info, setFailed, warning} from '@actions/core'

import pRetry from 'p-retry'
import {OpenAIOptions, Options} from './options'
import {
  AzureKeyCredential,
  ChatCompletions,
  GetChatCompletionsOptions,
  OpenAIClient
} from '@azure/openai'

// define type to save parentMessageId and conversationId
export interface Ids {
  parentMessageId?: string
  conversationId?: string
}

export class Bot {
  private readonly api: OpenAIClient | null = null // not free

  private readonly options: Options
  private readonly openaiOptions: OpenAIOptions

  constructor(options: Options, openaiOptions: OpenAIOptions) {
    this.options = options
    this.openaiOptions = openaiOptions
    if (process.env.OPENAI_API_KEY) {
      info(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY}`)
      info(`options.apiBaseUrl: ${options.apiBaseUrl}`)
      info(`process.env.OPENAI_BASE_URL: ${process.env.OPENAI_BASE_URL}`)
      this.api = new OpenAIClient(
        process.env.OPENAI_BASE_URL ?? 'https://api.openai.com',
        new AzureKeyCredential(process.env.OPENAI_API_KEY)
        // apiBaseUrl: options.apiBaseUrl,
        // systemMessage,
        // apiKey: process.env.OPENAI_API_KEY,
        // apiOrg: process.env.OPENAI_API_ORG ?? undefined,
        // debug: options.debug,
        // maxModelTokens: openaiOptions.tokenLimits.maxTokens,
        // maxResponseTokens: openaiOptions.tokenLimits.responseTokens,
        // completionParams: {
        //   temperature: options.openaiModelTemperature,
        //   model: openaiOptions.model
        // }
      )
    } else {
      const err =
        "Unable to initialize the OpenAI API, both 'OPENAI_API_KEY' environment variable are not available"
      throw new Error(err)
    }
  }

  chat = async (message: string, ids: Ids): Promise<[string, Ids]> => {
    let res: [string, Ids] = ['', {}]
    try {
      res = await this.chat_(message, ids)
      return res
    } catch (e) {
      if (e) {
        warning(`Failed to chat: ${e}`)
      }
      return res
    }
  }

  private readonly chat_ = async (
    message: string,
    ids: Ids
  ): Promise<[string, Ids]> => {
    // record timing
    const start = Date.now()
    if (!message) {
      return ['', {}]
    }

    const messages = [
      {role: 'system', content: this.options.systemMessage},
      {role: 'user', content: message}
    ]
    let response: AsyncIterable<ChatCompletions> | undefined

    if (this.api != null) {
      const opts: GetChatCompletionsOptions = {
        maxTokens: this.openaiOptions.tokenLimits.maxTokens,
        temperature: this.options.openaiModelTemperature,
        model: 'gpt-35-turbo-16k'
      }
      try {
        response = await pRetry(
          () =>
            this.api!.listChatCompletions(opts.model as string, messages, opts),
          {
            retries: this.options.openaiRetries
          }
        )
      } catch (e: any) {
        if (e instanceof Error) {
          info(
            `response: ${response}, failed to send message to openai: ${e}, backtrace: ${e.stack}`
          )
        }
      }
      const end = Date.now()
      info(`response: ${JSON.stringify(response)}`)
      info(
        `openai sendMessage (including retries) response time: ${
          end - start
        } ms`
      )
    } else {
      setFailed('The OpenAI API is not initialized')
    }
    let responseText = ''
    let parentMessageId = ''
    let conversationId = ''
    if (response != null) {
      for await (const item of response) {
        for (const choice of item.choices) {
          conversationId = choice.index.toString()
          responseText += choice.message
        }
        parentMessageId = item.id
      }
      info(`responseText: ${responseText}`)
    } else {
      warning('openai response is null')
    }
    // remove the prefix "with " in the response
    if (responseText.startsWith('with ')) {
      responseText = responseText.substring(5)
    }
    if (this.options.debug) {
      info(`openai responses: ${responseText}`)
    }
    const newIds: Ids = {
      parentMessageId: parentMessageId,
      conversationId: conversationId
    }
    return [responseText, newIds]
  }
}
