#!/usr/bin/env node

const { execFileSync } = require('node:child_process')

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

function tryRun(command, args, options = {}) {
  try {
    return run(command, args, options)
  } catch {
    return ''
  }
}

function runJson(command, args, options = {}) {
  const raw = run(command, args, options)
  return raw ? JSON.parse(raw) : null
}

function isBotUser(login) {
  const lower = String(login || '').toLowerCase()
  return (
    lower.includes('copilot') ||
    lower.includes('[bot]') ||
    lower === 'github-actions[bot]' ||
    lower.endsWith('[bot]')
  )
}

function toGitHubHandle(login) {
  return String(login || '').startsWith('@') ? String(login) : `@${login}`
}

function splitReward(totalAmount, users) {
  const totalCents = Math.round(totalAmount * 100)
  const base = Math.floor(totalCents / users.length)
  const remainder = totalCents % users.length
  return users.map((login, index) => ({
    payee: toGitHubHandle(login),
    reward: (base + (index < remainder ? 1 : 0)) / 100,
  }))
}

const [
  repositoryOwner,
  repositoryName,
  issueNumberRaw,
  payerRaw,
  currency,
  rewardRaw,
] = process.argv.slice(2)

if (!repositoryOwner || !repositoryName || !issueNumberRaw || !currency || !rewardRaw) {
  throw new Error(
    'Usage: node .github/scripts/share-reward.cjs <owner> <repo> <issueNumber> <payer> <currency> <reward>'
  )
}

const issueNumber = Number(issueNumberRaw)
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  throw new RangeError(`Invalid issue number: ${issueNumberRaw}`)
}

const totalReward = Number(rewardRaw)
if (!Number.isFinite(totalReward) || totalReward <= 0) {
  throw new RangeError(`Invalid reward amount: ${rewardRaw}`)
}

const payer = payerRaw && String(payerRaw).trim()
  ? String(payerRaw).trim().replace(/^@+/, '')
  : ''
const rewardTagName = `reward-${issueNumber}`

const existingTagPayload = tryRun('git', ['tag', '-l', '--format=%(contents)', rewardTagName])
if (existingTagPayload) {
  console.log(`Reward tag ${rewardTagName} already exists, skip recalculation.`)
  const existing = JSON.parse(existingTagPayload)
  const commentBody = buildComment(existing)
  run('gh', ['issue', 'comment', String(issueNumber), '--body', commentBody])
  process.exit(0)
}

const graphqlQuery = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        closedByPullRequestsReferences(first: 10) {
          nodes {
            url
            merged
            mergeCommit {
              oid
            }
          }
        }
      }
    }
  }
`

const graphData = runJson('gh', [
  'api',
  'graphql',
  '-f',
  `query=${graphqlQuery}`,
  '-f',
  `owner=${repositoryOwner}`,
  '-f',
  `name=${repositoryName}`,
  '-F',
  `number=${issueNumber}`,
])

const mergedPullRequests =
  graphData?.data?.repository?.issue?.closedByPullRequestsReferences?.nodes || []
const rewardSource = mergedPullRequests.find((item) => item?.merged && item?.mergeCommit?.oid)
if (!rewardSource?.url || !rewardSource?.mergeCommit?.oid) {
  throw new ReferenceError(`No merged PR with a merge commit found for issue #${issueNumber}.`)
}

const prMeta = runJson('gh', ['pr', 'view', rewardSource.url, '--json', 'author,assignees'])
const authorLogin = prMeta?.author?.login
const assigneeLogins = Array.isArray(prMeta?.assignees)
  ? prMeta.assignees.map((item) => item?.login).filter(Boolean)
  : []

const candidateUsers = Array.from(new Set([authorLogin, ...assigneeLogins].filter(Boolean)))
const rewardUsers = candidateUsers.filter((login) => !isBotUser(login))
if (!rewardUsers.length) {
  throw new ReferenceError(`No human contributors found for merged PR ${rewardSource.url}.`)
}

const entries = splitReward(totalReward, rewardUsers).map((item) => ({
  issue: `#${issueNumber}`,
  payer: toGitHubHandle(payer || repositoryOwner),
  payee: item.payee,
  currency,
  reward: item.reward,
}))

const payload = {
  issue: `#${issueNumber}`,
  sourcePr: rewardSource.url,
  mergeCommitSha: rewardSource.mergeCommit.oid,
  currency,
  totalReward,
  entries,
}

run('git', ['config', 'user.name', 'github-actions[bot]'])
run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
try {
  run('git', ['tag', '-a', rewardTagName, rewardSource.mergeCommit.oid, '-m', JSON.stringify(payload, null, 2)])
  run('git', ['push', 'origin', `refs/tags/${rewardTagName}`])
} finally {
  tryRun('git', ['config', '--unset', 'user.name'])
  tryRun('git', ['config', '--unset', 'user.email'])
}

const commentBody = buildComment(payload)
run('gh', ['issue', 'comment', String(issueNumber), '--body', commentBody])

function buildComment(payload) {
  const lines = [
    '## Reward Data',
    '',
    `Source PR: ${payload.sourcePr}`,
    '',
    '| Payee | Amount |',
    '| --- | --- |',
    ...payload.entries.map((entry) => `| ${entry.payee} | ${entry.currency} ${entry.reward.toFixed(2)} |`),
    '',
    '```json',
    JSON.stringify(payload.entries, null, 2),
    '```',
  ]
  return lines.join('\n')
}
