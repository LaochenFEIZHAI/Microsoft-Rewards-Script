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
console.log('Daily Set Dashboard Inspector v2')
console.log('========================================\n')

async function main() {
    let browser = null
    let context = null
    let page = null

    try {
        console.log('[1] Launching browser...')

        browser = await chromium.launch({
            headless: false,
            args: ['--no-sandbox', '--mute-audio', '--disable-setuid-sandbox']
        })

        context = await browser.newContext({
            viewport: { width: 384, height: 854 },
            userAgent:
                'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36 EdgA/146.0.3856.97'
        })

        page = await context.newPage()

        // Load saved session if exists
        const sessionPath = path.join(projectRoot, 'sessions', account.email, 'mobile')
        if (fs.existsSync(sessionPath)) {
            const sessionFile = path.join(sessionPath, 'session.json')
            if (fs.existsSync(sessionFile)) {
                const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
                await context.addCookies(sessionData.cookies || [])
                console.log('[OK] Session loaded from file')
            }
        }

        // Navigate to dashboard
        const dashboardUrl = 'https://rewards.bing.com/dashboard'
        console.log(`\n[2] Navigating to: ${dashboardUrl}`)

        await page.goto(dashboardUrl, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(3000)

        const currentUrl = page.url()
        console.log(`Current URL: ${currentUrl}`)

        // Step 1: Wait for login
        console.log('\n========================================')
        console.log('STEP 1: LOGIN REQUIRED')
        console.log('========================================')
        console.log('Please login manually in the browser window.')
        console.log('The script will wait for you to complete login.')
        console.log('')
        console.log('Press Ctrl+C at any time to cancel.')
        console.log('========================================\n')

        let loggedIn = false
        let attempts = 0
        const maxAttempts = 180 // 3 minutes

        while (!loggedIn && attempts < maxAttempts) {
            await page.waitForTimeout(1000)
            attempts++

            const url = page.url()

            // Check if we've reached the dashboard after login
            if (
                url.includes('/dashboard') ||
                (url.includes('rewards.bing.com') &&
                    !url.includes('welcome') &&
                    !url.includes('signin') &&
                    !url.includes('createuser') &&
                    !url.includes('login.live.com') &&
                    !url.includes('login.microsoft') &&
                    !url.includes('ppsecure'))
            ) {
                // Wait a bit more for page to fully load
                await page.waitForTimeout(3000)

                // Check if page has content (not just blank redirect)
                const hasContent = await page.evaluate(() => {
                    return document.body && document.body.children.length > 0
                })

                if (hasContent) {
                    loggedIn = true
                    console.log(`\n[✓] Login successful after ${attempts} seconds!`)
                    console.log(`Current URL: ${url}\n`)
                }
            }

            if (attempts % 15 === 0 && !loggedIn) {
                console.log(`[WAITING] ${attempts} seconds... Current URL: ${url}`)
            }
        }

        if (!loggedIn) {
            console.log('\n[✗] Login timeout after 3 minutes.')
            throw new Error('Login timeout')
        }

        // Step 2: Wait for language change
        console.log('========================================')
        console.log('STEP 2: CHANGE LANGUAGE TO ENGLISH')
        console.log('========================================')
        console.log('The page is currently in Chinese (中文).')
        console.log('Please change the page language to English.')
        console.log('')
        console.log('Instructions:')
        console.log('  1. Look for language settings (usually in footer or header)')
        console.log('  2. Select "English" or "English (US)"')
        console.log('  3. Wait for page to reload in English')
        console.log('')
        console.log('Press Enter when you have changed the language to English...')
        console.log('========================================\n')

        // Wait for user input
        await new Promise(resolve => {
            process.stdin.once('data', resolve)
        })

        console.log('\n[✓] User confirmed language change')
        await page.waitForTimeout(5000) // Wait for page to reload/settle

        // Step 3: Analyze Dashboard
        console.log('\n========================================')
        console.log('STEP 3: ANALYZING DASHBOARD STRUCTURE')
        console.log('========================================\n')

        const finalUrl = page.url()
        console.log(`Final URL: ${finalUrl}`)

        // Take screenshot
        await page.screenshot({
            path: path.join(projectRoot, 'debug-dashboard-final.png'),
            fullPage: true
        })
        console.log('[SAVED] Screenshot: debug-dashboard-final.png')

        // Get full HTML
        const html = await page.content()
        fs.writeFileSync(path.join(projectRoot, 'debug-dashboard-full.html'), html)
        console.log('[SAVED] Full HTML: debug-dashboard-full.html')

        // Analyze Daily Set
        console.log('\n[4] Locating Daily Set section...')

        const dailySetData = await page.evaluate(() => {
            // Keywords to search (English only now)
            const keywords = ['daily set', 'dailyset', 'daily-set']

            const allElements = Array.from(document.querySelectorAll('div, section, article'))
            let foundSection = null

            for (const el of allElements) {
                const text = (el.textContent || '').toLowerCase()
                const className = (el.className || '').toLowerCase()
                const id = (el.id || '').toLowerCase()

                const matchesKeyword = keywords.some(
                    keyword => text.includes(keyword) || className.includes(keyword) || id.includes(keyword)
                )

                if (matchesKeyword && el.children.length > 0 && el.children.length < 50) {
                    foundSection = {
                        html: el.outerHTML,
                        className: el.className,
                        id: el.id,
                        tagName: el.tagName,
                        childCount: el.children.length,
                        textPreview: text.substring(0, 300)
                    }
                    break
                }
            }

            return foundSection
        })

        if (dailySetData) {
            fs.writeFileSync(path.join(projectRoot, 'debug-dailyset-section.html'), dailySetData.html)
            console.log('\n[✓] Daily Set section found!')
            console.log(`  Tag: ${dailySetData.tagName}`)
            console.log(`  ID: ${dailySetData.id}`)
            console.log(`  Class: ${dailySetData.className}`)
            console.log(`  Children: ${dailySetData.childCount}`)
            console.log(`  Text Preview: "${dailySetData.textPreview.substring(0, 100)}..."`)
            console.log('[SAVED] HTML: debug-dailyset-section.html')
        } else {
            console.log('\n[✗] Daily Set section not found by text search')
        }

        // Find all clickable cards/activities
        console.log('\n[5] Finding all clickable activity cards...')

        const activities = await page.evaluate(() => {
            const items = []

            const selectors = [
                'a[href]',
                'button',
                '[onclick]',
                '[data-offerid]',
                '[offerid]',
                '.card',
                '[class*="card"]',
                '[class*="promo"]',
                '[role="button"]'
            ]

            for (const selector of selectors) {
                try {
                    const elements = Array.from(document.querySelectorAll(selector))

                    for (const el of elements) {
                        const href = el.getAttribute('href') || ''
                        const className = el.className || ''
                        const id = el.id || ''
                        const tagName = el.tagName
                        const offerId = el.getAttribute('data-offerid') || el.getAttribute('offerid')
                        const text = (el.textContent || '').trim().substring(0, 80)
                        const onclick = el.getAttribute('onclick') || ''

                        // Filter: only include if it looks like an activity
                        if (
                            (href && (href.includes('rewards') || href.includes('bing'))) ||
                            (className && (className.includes('card') || className.includes('promo'))) ||
                            offerId ||
                            onclick
                        ) {
                            items.push({
                                selector,
                                tagName,
                                className,
                                id,
                                href: href.substring(0, 100),
                                offerId,
                                text,
                                onclick: onclick.substring(0, 50),
                                html: el.outerHTML.substring(0, 600)
                            })
                        }
                    }
                } catch {}
            }

            // Deduplicate
            const uniqueItems = []
            const seen = new Set()

            for (const item of items) {
                const key = item.href || item.id || item.className
                if (!seen.has(key) && item.text.length > 0) {
                    seen.add(key)
                    uniqueItems.push(item)
                }
            }

            return uniqueItems
        })

        console.log(`\n[✓] Found ${activities.length} clickable items`)

        if (activities.length > 0) {
            console.log('\n  Top 10 items:')
            activities.slice(0, 10).forEach((item, i) => {
                console.log(`\n  ${i + 1}. ${item.tagName} - ${item.selector}`)
                console.log(`     Class: "${item.className}"`)
                console.log(`     ID: "${item.id}"`)
                console.log(`     Href: "${item.href}"`)
                console.log(`     Text: "${item.text}"`)
                if (item.offerId) console.log(`     OfferId: "${item.offerId}"`)
            })

            fs.writeFileSync(path.join(projectRoot, 'debug-activities.json'), JSON.stringify(activities, null, 2))
            console.log('\n[SAVED] Activities data: debug-activities.json')

            // Save first 5 HTMLs
            for (let i = 0; i < Math.min(activities.length, 5); i++) {
                if (activities[i].html) {
                    fs.writeFileSync(path.join(projectRoot, `debug-item-${i}.html`), activities[i].html)
                }
            }
            console.log('[SAVED] Individual item HTMLs: debug-item-0.html to debug-item-4.html')
        }

        // Look specifically for "Daily Set" text
        console.log('\n[6] Searching for "Daily Set" text elements...')

        const dailySetTexts = await page.evaluate(() => {
            const results = []
            const allElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p'))

            for (const el of allElements) {
                const text = (el.textContent || '').trim()

                if (text.toLowerCase().includes('daily set') && text.length < 50) {
                    results.push({
                        tagName: el.tagName,
                        className: el.className,
                        id: el.id,
                        text,
                        html: el.outerHTML
                    })
                }
            }

            return results
        })

        if (dailySetTexts.length > 0) {
            console.log(`\n[✓] Found ${dailySetTexts.length} "Daily Set" text elements`)
            dailySetTexts.forEach((el, i) => {
                console.log(`  ${i + 1}. ${el.tagName} - "${el.text}"`)
                console.log(`     Class: "${el.className}"`)
                console.log(`     ID: "${el.id}"`)
            })

            fs.writeFileSync(
                path.join(projectRoot, 'debug-dailyset-texts.json'),
                JSON.stringify(dailySetTexts, null, 2)
            )
            console.log('[SAVED] Daily Set texts: debug-dailyset-texts.json')
        } else {
            console.log('\n[✗] No "Daily Set" text elements found')
        }

        console.log('\n========================================')
        console.log('ANALYSIS COMPLETE')
        console.log('========================================')
        console.log('All debug files saved:')
        console.log('  - debug-dashboard-final.png (screenshot)')
        console.log('  - debug-dashboard-full.html (full HTML)')
        console.log('  - debug-dailyset-section.html (Daily Set section)')
        console.log('  - debug-activities.json (all activities data)')
        console.log('  - debug-dailyset-texts.json (Daily Set text elements)')
        console.log('')
        console.log('Browser will stay open for manual inspection.')
        console.log('Press Ctrl+C to close browser and exit.')
        console.log('========================================')

        // Keep browser open for manual inspection
        await new Promise(resolve => {
            process.on('SIGINT', resolve)
        })
    } catch (error) {
        console.error('\n[✗] Error:', error.message)

        // Save error info
        fs.writeFileSync(
            path.join(projectRoot, 'debug-error.log'),
            `Error: ${error.message}\nStack: ${error.stack}\nTime: ${new Date().toISOString()}`
        )
    } finally {
        // ALWAYS clean up browser process
        console.log('\n[CLEANUP] Closing browser...')

        if (page) {
            try {
                await page.close()
            } catch {}
        }

        if (context) {
            try {
                await context.close()
            } catch {}
        }

        if (browser) {
            try {
                await browser.close()
            } catch {}
        }

        console.log('[✓] Browser process cleaned up successfully')
        console.log('[✓] Script finished')
    }
}

main().catch(err => {
    console.error('\n[FATAL ERROR]', err)
    process.exit(1)
})
