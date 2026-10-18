/**
 * 视觉自查脚本。
 *
 * 通过 Chrome DevTools 协议接管已启动的应用：填登录表单、点进详情、翻设置页，
 * 每一步截一张图。走的是真实 DOM 交互（用 React 认得的原生 setter 写值），
 * 所以它同时也在验证登录与导航是真的能用，而不只是「能编译」。
 *
 * 用法：
 *   1. 另开一个终端：npx electron --remote-debugging-port=9222 .
 *   2. node scripts/shoot.mjs <watchId> <chipId>
 */

const PORT = process.env.CDP_PORT ?? '9222'
const OUT_DIR = process.env.SHOOT_DIR ?? '.'
const watchId = process.argv[2]
const chipId = process.argv[3]

if (!watchId || !chipId) {
  console.error('用法：node scripts/shoot.mjs <watchId> <chipId>')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 找到渲染进程那个页面 target。 */
async function findPageTarget() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // 应用还没起来，等一会儿再试。
    }
    await sleep(500)
  }
  throw new Error(`连不上 CDP（端口 ${PORT}）`)
}

class Cdp {
  #socket
  #id = 0
  #pending = new Map()

  static async connect(url) {
    const cdp = new Cdp()
    cdp.#socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      cdp.#socket.addEventListener('open', resolve, { once: true })
      cdp.#socket.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
    })
    cdp.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const entry = cdp.#pending.get(message.id)
      if (!entry) return
      cdp.#pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    })
    return cdp
  }

  send(method, params = {}) {
    this.#id += 1
    const id = this.#id
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** 在页面里跑一段表达式，返回它的值。 */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? '页面内执行失败')
    }
    return result.result?.value
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    const { writeFile } = await import('node:fs/promises')
    const path = `${OUT_DIR}/${name}.png`
    await writeFile(path, Buffer.from(data, 'base64'))
    console.log(`  · 已保存 ${path}`)
  }
}

/** React 受控输入必须用原生 setter 写值，否则 state 不会更新。 */
const fillHelper = `
window.__fill = (selector, value) => {
  const el = document.querySelector(selector)
  if (!el) return false
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}
window.__click = (text, tag = 'button') => {
  const nodes = [...document.querySelectorAll(tag)]
  const hit = nodes.find((n) => n.textContent.trim().includes(text))
  if (!hit) return false
  hit.click()
  return true
}
true
`

const target = await findPageTarget()
const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')

console.log('\n▸ 登录页')
await cdp.evaluate(fillHelper)
await sleep(600)
await cdp.shot('shot-1-login')

// 真实填写并提交登录表单。
const filled = await cdp.evaluate(`
  (() => {
    const inputs = [...document.querySelectorAll('.field input')]
    if (inputs.length < 3) return 'inputs:' + inputs.length
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const values = ['http://127.0.0.1:8000', ${JSON.stringify(watchId)}, ${JSON.stringify(chipId)}]
    inputs.forEach((input, index) => {
      setter.call(input, values[index])
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return 'ok'
  })()
`)
console.log(`  · 填表：${filled}`)
await sleep(300)

const submitted = await cdp.evaluate(`window.__click('进入好友圈')`)
console.log(`  · 提交：${submitted}`)
await sleep(3500)

console.log('\n▸ 动态流')
await cdp.shot('shot-2-feed')

const feedInfo = await cdp.evaluate(`
  (() => ({
    moments: document.querySelectorAll('.moment').length,
    firstText: (document.querySelector('.moment__text')?.textContent ?? '').slice(0, 40),
    topics: [...document.querySelectorAll('.topics__tag')].slice(0, 4).map((t) => t.textContent.trim()),
    images: document.querySelectorAll('.imggrid__cell').length,
    videos: document.querySelectorAll('.video').length,
    liked: document.querySelectorAll('.moment__action[data-on="true"]').length,
    tabs: [...document.querySelectorAll('.feed__tab')].map((t) => t.textContent.trim()),
  }))()
`)
console.log('  · 流内容：', JSON.stringify(feedInfo, null, 0))

console.log('\n▸ 发布器展开')
await cdp.evaluate(`window.__click('写点什么')`)
await sleep(700)
const composerInfo = await cdp.evaluate(`
  (() => ({
    open: Boolean(document.querySelector('.composer')),
    chips: document.querySelectorAll('.picker__chip').length,
    tools: [...document.querySelectorAll('.composer__tool')].map((t) => t.textContent.trim()),
  }))()
`)
console.log('  · 发布器：', JSON.stringify(composerInfo))
await cdp.shot('shot-3-composer')

// 收起发布器，免得挡住后面的操作。
await cdp.evaluate(`window.__click('取消')`)
await sleep(500)

console.log('\n▸ 大图灯箱')
const opened = await cdp.evaluate(`
  (() => {
    const cell = document.querySelector('.imggrid__cell')
    if (!cell) return false
    cell.click()
    return true
  })()
`)
if (opened) {
  await sleep(900)
  const lightboxInfo = await cdp.evaluate(`
    (() => ({
      open: Boolean(document.querySelector('.lightbox')),
      count: document.querySelector('.lightbox__count')?.textContent.trim() ?? '',
    }))()
  `)
  console.log('  · 灯箱：', JSON.stringify(lightboxInfo))
  await cdp.shot('shot-4-lightbox')
  await cdp.evaluate(`
    document.querySelector('.lightbox__btn')?.click()
    true
  `)
  await sleep(500)
} else {
  console.log('  · 当前页没有图片，跳过')
}

console.log('\n▸ 动态详情')
const toDetail = await cdp.evaluate(`
  (() => {
    const target = [...document.querySelectorAll('.moment__action')].find((n) => n.textContent.includes('评论'))
    if (!target) return false
    target.click()
    return true
  })()
`)
if (toDetail) {
  await sleep(4000)
  const detailInfo = await cdp.evaluate(`
    (() => ({
      hasDetail: Boolean(document.querySelector('.detail__moment')),
      loading: Boolean(document.querySelector('.detail__loading')),
      author: document.querySelector('.detail__author')?.textContent ?? '',
      comments: document.querySelectorAll('.detail .comment').length,
    }))()
  `)
  console.log('  · 详情：', JSON.stringify(detailInfo))
  await cdp.shot('shot-5-detail')

  await cdp.evaluate(`window.__click('返回', '.detail__back')`)
  await sleep(900)
} else {
  console.log('  · 没找到评论入口，跳过')
}

console.log('\n▸ 账号与设置')
await cdp.evaluate(`window.__click('账号与设置', '.rail__link')`)
await sleep(900)
const settingsInfo = await cdp.evaluate(`
  (() => ({
    hasSettings: Boolean(document.querySelector('.settings__title')),
    rows: document.querySelectorAll('.settings__dl dt').length,
  }))()
`)
console.log('  · 设置页：', JSON.stringify(settingsInfo))
await cdp.shot('shot-6-settings')

console.log('\n▸ 只看我发的')
await cdp.evaluate(`window.__click('动态', '.rail__link')`)
await sleep(700)
await cdp.evaluate(`window.__click('我发的', '.feed__tab')`)
await sleep(900)
const mineInfo = await cdp.evaluate(`
  (() => ({
    moments: document.querySelectorAll('.moment').length,
    empty: Boolean(document.querySelector('.feed__empty')),
  }))()
`)
console.log('  · 只看我：', JSON.stringify(mineInfo))
await cdp.shot('shot-7-mine')

console.log('\n✅ 截图完成')
process.exit(0)
