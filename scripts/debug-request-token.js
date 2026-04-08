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
console.log('Request Token Debug Tool')
console.log('========================================')
console.log(`Account: ${account.email}`)
console.log(`Base URL: ${config.baseURL}`)
console.log('')

async function main() {
    console.log('[1] Launching browser (mobile context)...')

    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--mute-audio',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--no-first-run',
            '--no-default-browser-check'
        ]
    })

    // Create mobile context
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    })

    const page = await context.newPage()

    // Wait for user to login
    console.log('[2] Please login manually in the browser window...')
    console.log('Waiting for login to complete...')

    let loggedIn = false
    let checkCount = 0
    const maxChecks = 120 // 2 minutes

    while (!loggedIn && checkCount < maxChecks) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        checkCount++

        const url = page.url()

        // Check if logged in to rewards
        if (url.includes('rewards.bing.com') && !url.includes('signin') && !url.includes('createuser')) {
            console.log(`[CHECK ${checkCount}] URL: ${url}`)

            // Check for user element
            const hasUserElement = await page.locator('#id_n, .id_button, [data-testid="identityBanner"]').count() > 0

            if (hasUserElement) {
                loggedIn = true
                console.log('[SUCCESS] Login detected!')
            }
        } else {
            if (checkCount % 10 === 0) {
                console.log(`[CHECK ${checkCount}] Still waiting... URL: ${url}`)
            }
        }
    }

    if (!loggedIn) {
        console.log('[TIMEOUT] Login not detected within 2 minutes. Continue anyway.')
    }

    console.log('')
    console.log('[3] Navigating to rewards page...')

    // Navigate to rewards page
    await page.goto(`${config.baseURL}?_=${Date.now()}`, {
        waitUntil: 'networkidle',
        timeout: 10000
    }).catch(e => {
        console.log(`[ERROR] Navigation failed: ${e.message}`)
    })

    await new Promise(resolve => setTimeout(resolve, 3000))

    const currentUrl = page.url()
    console.log(`Current URL: ${currentUrl}`)

    // Analyze page
    const u = new URL(currentUrl)
    const atRewardHome = u.hostname === 'rewards.bing.com' && u.pathname === '/'

    console.log('')
    console.log('[4] Analyzing page content...')

    // Get page content
    const html = await page.content()
    const $ = await loadCheerio(html)

    // Check for modern dashboard
    const modernDashboard = $('section#dailyset').length > 0
    console.log(`Modern Dashboard: ${modernDashboard}`)

    // Try to find request token
    const inputToken = $('input[name="__RequestVerificationToken"]').attr('value')
    const metaToken = $('meta[name="__RequestVerificationToken"]').attr('content')

    console.log('')
    console.log('[5] Token search results:')
    console.log(`  Input token: ${inputToken ? inputToken.substring(0, 20) + '...' : 'NOT FOUND'}`)
    console.log(`  Meta token: ${metaToken ? metaToken.substring(0, 20) + '...' : 'NOT FOUND'}`)

    // Check all inputs
    const allInputs = $('input[type="hidden"]')
    console.log(`  Total hidden inputs: ${allInputs.length}`)
    
    allInputs.each((i, el) => {
        const name = $(el).attr('name')
        if (name && name.includes('Token')) {
            console.log(`    - ${name}`)
        }
    })

    // Check all meta tags
    const allMetas = $('meta')
    console.log(`  Total meta tags: ${allMetas.length}`)
    
    allMetas.each((i, el) => {
        const name = $(el).attr('name')
        if (name && name.includes('Token')) {
            console.log(`    - ${name}`)
        }
    })

    // Save page HTML for analysis
    const htmlFile = path.join(projectRoot, 'debug-rewards-page.html')
    fs.writeFileSync(htmlFile, html)
    console.log(`\n[SAVED] Page HTML saved to: ${htmlFile}`)

    // Screenshot
    const screenshotFile = path.join(projectRoot, 'debug-rewards-screenshot.png')
    await page.screenshot({ path: screenshotFile, fullPage: false })
    console.log(`[SAVED] Screenshot saved to: ${screenshotFile}`)

    console.log('')
    console.log('========================================')
    console.log('Debug completed. You can close the browser.')
    console.log('Press Ctrl+C to exit.')
    console.log('========================================')

    await new Promise(resolve => {
        process.on('SIGINT', resolve)
    })

    await browser.close()
}

// Simple cheerio loader
async function loadCheerio(html: string) {
    const cheerio = await import('cheerio')
    return cheerio.load(html)
}

main().catch(error => {
    console.error('[ERROR]', error)
    process.exit(1)
})