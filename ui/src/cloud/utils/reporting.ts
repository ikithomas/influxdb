import {useState, useEffect} from 'react'
import {isEmpty} from 'lodash'

import {
  reportPoints as reportPointsAPI,
  Point,
  PointTags,
  PointFields,
} from 'src/cloud/apis/reporting'

import {isFlagEnabled} from 'src/shared/utils/featureFlag'

export {Point, PointTags, PointFields} from 'src/cloud/apis/reporting'

let reportingTags = {}
let reportingPoints = []
let reportDecayTimeout = null
let reportMaxTimeout = null

const REPORT_DECAY = 500 // number of miliseconds to wait after last event before sending
const REPORT_MAX_WAIT = 5000 // max number of miliseconds to wait between sends
const REPORT_MAX_LENGTH = 300 // max number of events to queue before sending

export const toNano = (ms: number) => Math.round(ms * 1000000)

export const updateReportingContext = (key: string, value: string) => {
  reportingTags = {...reportingTags, [key]: value}
}

const pooledEvent = ({timestamp, measurement, fields, tags}: Point) => {
  if (isEmpty(fields)) {
    fields = {source: 'ui'}
  }

  reportingPoints.push({
    measurement: 'UI Event', // artifact of sharing the tools cluster
    tags: {...reportingTags, ...tags, event: measurement},
    fields,
    timestamp,
  })

  if (!!reportDecayTimeout) {
    clearTimeout(reportDecayTimeout)
    reportDecayTimeout = null
  }

  if (reportingPoints.length >= REPORT_MAX_LENGTH) {
    if (!!reportMaxTimeout) {
      clearTimeout(reportMaxTimeout)
      reportMaxTimeout = null
    }

    reportPointsAPI({
      points: reportingPoints.slice(),
    })

    reportingPoints = []

    return
  }

  if (!reportMaxTimeout) {
    reportMaxTimeout = setTimeout(() => {
      reportMaxTimeout = null

      // points already cleared
      if (!reportingPoints.length) {
        return
      }

      clearTimeout(reportDecayTimeout)
      reportDecayTimeout = null

      reportPointsAPI({
        points: reportingPoints.slice(),
      })

      reportingPoints = []
    }, REPORT_MAX_WAIT)
  }

  reportDecayTimeout = setTimeout(() => {
    reportPointsAPI({
      points: reportingPoints.slice(),
    })

    reportingPoints = []
  }, REPORT_DECAY)
}

export const gaEvent = (event: string, payload: object = {}) => {
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({
    event,
    ...payload,
  })
}

export const event = (
  title: string,
  meta: PointTags = {},
  values: PointFields = {}
): void => {
  let time = meta.time ? new Date(meta.time).valueOf() : Date.now()

  if (isNaN(time)) {
    time = Date.now()
  }

  delete meta.time

  if (isFlagEnabled('streamEvents')) {
    /* eslint-disable no-console */
    console.log(`Event:  [ ${title} ]`)
    if (Object.keys(meta).length) {
      console.log(
        Object.entries(meta)
          .map(([k, v]) => `        ${k}: ${v}`)
          .join('\n')
      )
    }
    /* eslint-enable no-console */
  }

  gaEvent(title, {...values, ...meta})

  pooledEvent({
    timestamp: time,
    measurement: title,
    fields: {
      source: 'ui',
      ...values,
    },
    tags: {...meta},
  })
}

export const useLoadTimeReporting = (title: string) => {
  const [loadStartTime] = useState(toNano(Date.now()))
  useEffect(() => {
    event(title, {
      time: loadStartTime,
    })
  }, [])
}
