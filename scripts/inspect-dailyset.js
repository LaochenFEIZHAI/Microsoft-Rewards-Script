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
console.log('Daily Set DOM Structure Inspector')
console.log('========================================\n')

async function main() {
    console.log('[1] Launching browser...')

    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--mute-audio']
    })

    const context = await browser.newContext({
        viewport: { width: 384, height: 854 },
        userAgent:
            'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36 EdgA/146.0.3856.97'
    })

    const page = await context.newPage()

    // Load saved session
    const sessionPath = path.join(projectRoot, 'sessions', account.email, 'mobile')
    if (fs.existsSync(sessionPath)) {
        const sessionFile = path.join(sessionPath, 'session.json')
        if (fs.existsSync(sessionFile)) {
            const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
            await context.addCookies(sessionData.cookies || [])
            console.log('[OK] Session loaded')
        }
    }

    console.log('[2] Navigating to dashboard...')
    await page.goto(config.baseURL, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(5000)

    console.log('[3] Analyzing Daily Set structure...')

    // Get full page HTML
    const html = await page.content()
    fs.writeFileSync(path.join(projectRoot, 'debug-dailyset-full.html'), html)
    console.log('[SAVED] Full HTML saved to: debug-dailyset-full.html')

    // Look for Daily Set section
    console.log('\n[4] Searching for Daily Set elements...')

    // Try multiple possible selectors
    const possibleSelectors = [
        '#dailyset',
        '#DailySet',
        '[data-testid="dailyset"]',
        '.daily-set',
        '.dailyset',
        'section[id*="daily"]',
        'div[id*="dailyset"]',
        '[class*="dailyset"]',
        '[class*="daily-set"]'
    ]

    for (const selector of possibleSelectors) {
        try {
            const elements = await page.locator(selector).count()
            if (elements > 0) {
                console.log(`[FOUND] ${selector}: ${elements} elements`)

                // Get the HTML of the first matching element
                const elementHtml = await page.locator(selector).first().innerHTML()
                const outputFile = `debug-dailyset-${selector.replace(/[^\w]/g, '_')}.html`
                fs.writeFileSync(path.join(projectRoot, outputFile), elementHtml)
                console.log(`[SAVED] Element HTML saved to: ${outputFile}`)
            }
        } catch (e) {
            console.log(`[NOT FOUND] ${selector}`)
        }
    }

    // Try to find activity cards/items
    console.log('\n[5] Searching for activity cards...')

    const cardSelectors = [
        '.card',
        '.activity-card',
        '.promo-card',
        '[data-offerid]',
        '[offerid]',
        '.morePromotions .promoItem',
        '.promotional-item'
    ]

    for (const selector of cardSelectors) {
        try {
            const elements = await page.locator(selector).count()
            if (elements > 0) {
                console.log(`[FOUND] ${selector}: ${elements} elements`)

                // Get all matching elements
                for (let i = 0; i < Math.min(elements, 5); i++) {
                    try {
                        const el = await page.locator(selector).nth(i)
                        const offerId =
                            (await el.getAttribute('data-offerid').catch(() => null)) ||
                            (await el.getAttribute('offerid').catch(() => null))
                        const text = await el.textContent().catch(() => '')

                        console.log(`  Element ${i}: offerId=${offerId || 'N/A'}, text="${text?.substring(0, 50)}..."`)

                        // Get HTML
                        const elementHtml = await el.innerHTML()
                        fs.writeFileSync(path.join(projectRoot, `debug-card-${i}.html`), elementHtml)
                    } catch {}
                }
            }
        } catch {}
    }

    // Take screenshot
    const screenshotFile = path.join(projectRoot, 'debug-dailyset-screenshot.png')
    await page.screenshot({ path: screenshotFile, fullPage: true })
    console.log(`\n[SAVED] Screenshot saved to: ${screenshotFile}`)

    // Execute JavaScript to find Daily Set data
    console.log('\n[6] Extracting Daily Set data via JavaScript...')

    const dailySetData = await page.evaluate(() => {
        // Try to find React/Vue data or DOM structure
        const result = {
            dailySetSection: null,
            cards: [],
            rawHTML: ''
        }

        // Find section containing "Daily Set" text
        const allSections = document.querySelectorAll('section, div[class*="section"], div[id*="section"]')
        for (const section of allSections) {
            const text = section.textContent || ''
            if (text.toLowerCase().includes('daily set') || text.includes('Daily Set')) {
                result.dailySetSection = {
                    id: section.id,
                    className: section.className,
                    tagName: section.tagName,
                    childCount: section.children.length
                }
                result.rawHTML = section.outerHTML.substring(0, 2000)
                break
            }
        }

        // Find all clickable elements that might be activities
        const clickableElements = document.querySelectorAll(
            'a[href*="rewards"], button, [role="button"], .clickable, [onclick]'
        )
        for (const el of clickableElements) {
            const offerId = el.getAttribute('data-offerid') || el.getAttribute('offerid') || 'N/A'
            const href = el.getAttribute('href') || 'N/A'
            const text = el.textContent?.substring(0, 30) || 'N/A'

            result.cards.push({
                offerId,
                href,
                text,
                tagName: el.tagName,
                className: el.className
            })
        }

        return result
    })

    fs.writeFileSync(path.join(projectRoot, 'debug-dailyset-data.json'), JSON.stringify(dailySetData, null, 2))
    console.log('[SAVED] Daily Set data saved to: debug-dailyset-data.json')

    console.log('\n[7] Analysis results:')
    console.log(`Daily Set section: ${JSON.stringify(dailySetData.dailySetSection)}`)
    console.log(`Found ${dailySetData.cards.length} clickable elements`)

    console.log('\n========================================')
    console.log('Browser will stay open for manual inspection.')
    console.log('Press Ctrl+C to close and exit.')
    console.log('========================================')

    await new Promise(resolve => {
        process.on('SIGINT', resolve)
    })

    await browser.close()
}

main().catch(err => {
    console.error('[ERROR]', err)
    process.exit(1)
})
