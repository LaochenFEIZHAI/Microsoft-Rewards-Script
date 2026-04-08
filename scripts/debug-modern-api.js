import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'patchright'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = __dirname.replace('/scripts', '')

const configPath = path.join(projectRoot, 'src', 'config.json')
const accountsPath = path.join(projectRoot, 'src', 'accounts.json')

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'))
const account = accounts[0]

console.log('========================================')
console.log('Modern Dashboard API Debugger')
console.log('========================================\n')

async function main() {
    console.log('[1] Launching mobile browser...')

    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--mute-audio', '--disable-setuid-sandbox']
    })

    const context = await browser.newContext({
        viewport: { width: 384, height: 854 },
        userAgent:
            'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36 EdgA/146.0.3856.97'
    })

    const page = await context.newPage()

    // 监听网络请求
    const requests = []
    page.on('request', req => {
        if (req.url().includes('api') || req.url().includes('reportactivity')) {
            requests.push({
                url: req.url(),
                method: req.method(),
                postData: req.postData(),
                headers: req.headers()
            })
        }
    })

    page.on('response', res => {
        if (res.url().includes('api') || res.url().includes('reportactivity')) {
            console.log(`\n[RESPONSE] ${res.status()} ${res.url()}`)
        }
    })

    console.log('[2] Loading saved session...')

    // 加载已保存的 session
    const sessionPath = path.join(projectRoot, 'sessions', account.email, 'mobile')
    if (fs.existsSync(sessionPath)) {
        const sessionFile = path.join(sessionPath, 'session.json')
        if (fs.existsSync(sessionFile)) {
            const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
            await context.addCookies(sessionData.cookies || [])
            console.log('[OK] Session loaded')
        } else {
            console.log('[WARN] No session file found, please login manually')
        }
    }

    console.log('[3] Navigating to rewards page...')
    await page.goto(config.baseURL, { waitUntil: 'networkidle' })
    await new Promise(r => setTimeout(r, 3000))

    const currentUrl = page.url()
    console.log(`Current URL: ${currentUrl}`)

    // 检查是否登录
    const html = await page.content()
    const hasDailySet = html.includes('dailyset') || html.includes('Daily Set')
    console.log(`\nDashboard type: ${hasDailySet ? 'Modern' : 'Legacy'}`)

    // 获取一个活动
    console.log('\n[4] Finding an activity to test...')

    // 等待页面加载
    await page.waitForSelector('[data-offerid], [offerid]', { timeout: 5000 }).catch(() => {
        console.log('[WARN] No offer elements found')
    })

    // 尝试找到一个可点击的活动
    const offerElement = await page
        .locator('[data-offerid]')
        .first()
        .catch(() => null)

    if (offerElement) {
        const offerId = await offerElement.getAttribute('data-offerid')
        console.log(`Found offer: ${offerId}`)

        // 点击活动
        console.log('\n[5] Clicking activity...')
        await offerElement.click()
        await new Promise(r => setTimeout(r, 3000))
    }

    // 拦截 API 请求
    console.log('\n[6] Monitoring API requests...')
    console.log('Please manually click on an activity in the browser.')
    console.log('Press Ctrl+C when done.\n')

    // 等待用户操作
    await new Promise(resolve => {
        process.on('SIGINT', resolve)
        setTimeout(resolve, 120000) // 2分钟超时
    })

    // 保存捕获的请求
    const outputFile = path.join(projectRoot, 'debug-api-requests.json')
    fs.writeFileSync(outputFile, JSON.stringify(requests, null, 2))
    console.log(`\n[SAVED] Captured ${requests.length} API requests to: ${outputFile}`)

    // 分析请求
    if (requests.length > 0) {
        console.log('\n[ANALYSIS] API Requests:')
        requests.forEach((req, i) => {
            console.log(`\n${i + 1}. ${req.method} ${req.url}`)
            if (req.postData) {
                const params = new URLSearchParams(req.postData)
                console.log('   Post Data:')
                for (const [key, value] of params.entries()) {
                    if (key === '__RequestVerificationToken') {
                        console.log(`     - ${key}: ${value.substring(0, 20)}...`)
                    } else {
                        console.log(`     - ${key}: ${value}`)
                    }
                }
            }
        })
    }

    await browser.close()
    console.log('\n[DONE] Browser closed')
}

main().catch(err => {
    console.error('[ERROR]', err)
    process.exit(1)
})
