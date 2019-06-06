import {groupBy} from 'lodash'
import * as colors from 'colors'

import {
  Action,
  EffectConcrete,
  EffectGroup,
  Observation,
  NodeId,
} from './elements'

import {
  NetworkModel
} from './network'

import logger from './logger'


const SOFT_TIMEOUT_MS = 8000
const HARD_TIMEOUT_MS = 30000

type InstrumentedObservation = {
  observation: Observation,
  stats: {
    timestamp: number
  }
}

type AwaitCallback = {
  nodes: Array<NodeId> | null,
  resolve: () => void,
  reject?: (any) => void,
  called?: boolean,
}

type AwaitCallbackWithTimeout = AwaitCallback & {
  softTimeout: any,
  hardTimeout: any,
  id: number,
}

export class Waiter {
  pendingEffects: Array<EffectConcrete>
  networkModel: NetworkModel
  complete: Promise<null>
  startTime: number
  callbacks: Array<AwaitCallbackWithTimeout>
  lastCallbackId: number

  completedObservations: Array<InstrumentedObservation>

  constructor(networkModel: NetworkModel) {
    this.pendingEffects = []
    this.completedObservations = []
    this.callbacks = []
    this.networkModel = networkModel
    this.startTime = Date.now()
    this.lastCallbackId = 1
  }

  registerCallback (cb: AwaitCallback) {
    logger.silly('rrrrrrrrrrREGISTERING callback with', this.pendingEffects.length, 'pending')
    if (this.pendingEffects.length > 0) {
      // make it wait
      const tickingCallback = Object.assign({}, cb, {
        softTimeout: setTimeout(this.onSoftTimeout(cb), SOFT_TIMEOUT_MS),
        hardTimeout: setTimeout(this.onHardTimeout(cb), HARD_TIMEOUT_MS),
        id: this.lastCallbackId++
      })
      this.callbacks.push(tickingCallback)
    } else {
      // nothing to wait for
      cb.resolve()
    }
  }

  handleObservation (o: Observation) {
    this.consumeObservation(o)
    this.expandObservation(o)
    logger.silly(colors.yellow('wwwwwwwwwwwwwwwwwwwWAITING ON THIS MANY: '), this.pendingEffects.length)
    logger.silly(colors.yellow('last signal:'))
    logger.silly(o)
    logger.silly(colors.yellow('pending effects:'))
    logger.silly(this.pendingEffects)
    logger.silly(colors.yellow('callbacks:'), this.callbacks.length)
    this.checkCompletion()
  }

  consumeObservation (o: Observation) {
    const wasNotEmpty = this.pendingEffects.length > 0
    this.pendingEffects = this.pendingEffects.filter(({event, targetNode}) => {
      const matches = o.signal.event === event && o.node === targetNode
      if (matches) {
        // side effect in a filter, but it works
        this.completedObservations.push({
          observation: o,
          stats: {
            timestamp: Date.now()
          }
        })
      }
      return !matches
    })
  }

  expandObservation (o: Observation) {
    const effects = this.networkModel.determineEffects(o)
    this.pendingEffects = this.pendingEffects.concat(effects)
  }

  checkCompletion () {
    const grouped = groupBy(this.pendingEffects, e => e.targetNode)
    this.callbacks = this.callbacks.filter(({
      nodes, resolve, softTimeout, hardTimeout, id
    }) => {
      const completed = nodes
        ? nodes.every(nodeId => !(nodeId in grouped) || grouped[nodeId].length === 0)
        : this.pendingEffects.length === 0
      if (completed) {
        resolve()
        clearTimeout(softTimeout)
        clearTimeout(hardTimeout)
        logger.silly('resollllllved callback id:', id)
      }
      return !completed
    })
  }

  timeoutDump = () => {
    console.log("Still waiting on the following", colors.red('' + this.pendingEffects.length), "signal(s):")
    console.log(this.pendingEffects)
  }

  onSoftTimeout = (cb: AwaitCallback) => () => {
    console.log(colors.yellow("vvvv    hachiko warning    vvvv"))

    console.log(
      colors.yellow("a hachiko callback has been waiting for"),
      colors.yellow.underline(`${SOFT_TIMEOUT_MS / 1000} seconds`),
      colors.yellow("with no change"),
    )
    this.timeoutDump()
    console.log(colors.yellow("^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^"))
  }


  onHardTimeout = (cb: AwaitCallback) => () => {
    console.log(colors.red("vvvv  hachiko timed out!  vvvv"))
    this.timeoutDump()
    console.log(colors.red("^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^"))
    if (cb.reject) {
      cb.reject("hachiko timeout")
    } else {
      throw new Error("hachiko timeout!!")
    }
  }
}
