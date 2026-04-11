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
console.log('Daily Set Dashboard Inspector')
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

    // Load saved session if exists
    const sessionPath = path.join(projectRoot, 'sessions', account.email, 'mobile')
    if (fs.existsSync(sessionPath)) {
        const sessionFile = path.join(sessionPath, 'session.json')
        if (fs.existsSync(sessionFile)) {
            const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
            await context.addCookies(sessionData.cookies || [])
            console.log('[OK] Session loaded from file')
        } else {
            console.log('[WARN] No session file found')
        }
    } else {
        console.log('[WARN] No session directory found')
    }

    // Navigate to dashboard
    const dashboardUrl = 'https://rewards.bing.com/dashboard'
    console.log(`\n[2] Navigating to: ${dashboardUrl}`)

    await page.goto(dashboardUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(3000)

    const currentUrl = page.url()
    console.log(`Current URL: ${currentUrl}`)

    // Check if we need to login
    const needsLogin =
        currentUrl.includes('welcome') ||
        currentUrl.includes('signin') ||
        currentUrl.includes('createuser') ||
        !currentUrl.includes('dashboard')

    if (needsLogin) {
        console.log('\n[3] Login required. Please login manually in the browser window.')
        console.log('Waiting for login to complete...')
        console.log('(The page will redirect to dashboard after login)\n')

        // Wait for login completion
        let loggedIn = false
        let attempts = 0
        const maxAttempts = 120 // 2 minutes

        while (!loggedIn && attempts < maxAttempts) {
            await page.waitForTimeout(1000)
            attempts++

            const url = page.url()

            // Check if we've reached the dashboard
            if (
                url.includes('/dashboard') ||
                (url.includes('rewards.bing.com') &&
                    !url.includes('welcome') &&
                    !url.includes('signin') &&
                    !url.includes('createuser') &&
                    !url.includes('login.live.com') &&
                    !url.includes('login.microsoft'))
            ) {
                // Just check URL - if we're on dashboard, we're logged in
                loggedIn = true
                console.log(`\n[OK] Dashboard detected after ${attempts} seconds!`)
                console.log(`Current URL: ${url}`)
            }

            if (attempts % 10 === 0) {
                console.log(`[WAITING] ${attempts} seconds elapsed... URL: ${url}`)
            }
        }

        if (!loggedIn) {
            console.log('\n[ERROR] Login timeout after 2 minutes.')
            console.log('Please try again or check your network connection.')
            await browser.close()
            return
        }

        // Wait for page to fully load after login
        await page.waitForTimeout(5000)
    } else {
        console.log('\n[OK] Already logged in, proceeding to analysis...')
    }

    console.log('\n[4] Dashboard loaded. Analyzing Daily Set structure...')

    // Take screenshot
    await page.screenshot({
        path: path.join(projectRoot, 'debug-dashboard-screenshot.png'),
        fullPage: true
    })
    console.log('[SAVED] Screenshot: debug-dashboard-screenshot.png')

    // Get full HTML
    const html = await page.content()
    fs.writeFileSync(path.join(projectRoot, 'debug-dashboard-full.html'), html)
    console.log('[SAVED] Full HTML: debug-dashboard-full.html')

    // Find Daily Set section (support both English and Chinese)
    console.log('\n[5] Locating Daily Set section...')

    const dailySetData = await page.evaluate(() => {
        // Search keywords in both English and Chinese
        const keywords = [
            'daily set',
            '每日任务',
            '每日活动',
            'dailyset',
            'daily-set',
            'dailysetpromotions',
            '任务',
            '活动'
        ]

        // Find all divs and sections
        const allElements = Array.from(document.querySelectorAll('div, section, article'))

        let foundSection = null

        for (const el of allElements) {
            const text = (el.textContent || '').toLowerCase()
            const className = (el.className || '').toLowerCase()
            const id = (el.id || '').toLowerCase()
            const dataAttrs = Array.from(el.attributes)
                .filter(attr => attr.name.startsWith('data-'))
                .map(attr => `${attr.name}="${attr.value}"`)
                .join(' ')

            // Check if any keyword matches
            const matchesKeyword = keywords.some(
                keyword =>
                    text.includes(keyword) ||
                    className.includes(keyword.replace(' ', '-')) ||
                    id.includes(keyword.replace(' ', '-')) ||
                    dataAttrs.toLowerCase().includes(keyword.replace(' ', '-'))
            )

            if (matchesKeyword && el.children.length > 0) {
                // Found potential Daily Set section
                // Get more info about it
                const childInfo = Array.from(el.children)
                    .slice(0, 5)
                    .map(child => ({
                        tagName: child.tagName,
                        className: child.className,
                        id: child.id,
                        textContent: (child.textContent || '').substring(0, 100)
                    }))

                foundSection = {
                    html: el.outerHTML,
                    className: el.className,
                    id: el.id,
                    tagName: el.tagName,
                    dataAttrs: dataAttrs,
                    childCount: el.children.length,
                    childInfo,
                    textPreview: text.substring(0, 500)
                }

                // Only return the first (most relevant) match
                break
            }
        }

        return foundSection
    })

    if (dailySetData) {
        fs.writeFileSync(path.join(projectRoot, 'debug-dailyset-section.html'), dailySetData.html)
        console.log('\n[FOUND] Daily Set section!')
        console.log(`  Tag: ${dailySetData.tagName}`)
        console.log(`  ID: ${dailySetData.id}`)
        console.log(`  Class: ${dailySetData.className}`)
        console.log(`  Data Attributes: ${dailySetData.dataAttrs}`)
        console.log(`  Children: ${dailySetData.childCount}`)
        console.log(`  Text Preview: ${dailySetData.textPreview.substring(0, 100)}...`)

        if (dailySetData.childInfo.length > 0) {
            console.log('\n  First 5 children:')
            dailySetData.childInfo.forEach((child, i) => {
                console.log(`    ${i}. ${child.tagName} - class="${child.className}" id="${child.id}"`)
                console.log(`       Text: "${child.textContent}"`)
            })
        }

        console.log('\n[SAVED] Daily Set HTML: debug-dailyset-section.html')
    } else {
        console.log('\n[NOT FOUND] Daily Set section by keyword search')
        console.log('[INFO] Trying alternative search methods...')
    }

    // Find all activity items/cards regardless
    console.log('\n[6] Finding all activity items in the page...')

    const activities = await page.evaluate(() => {
        const items = []

        // Multiple selectors for activity cards
        const selectors = [
            '[data-offerid]',
            '[offerid]',
            '.promoItem',
            '.promo-item',
            '.card',
            '.activity-card',
            '.task-card',
            '[class*="promo"]',
            '[class*="task"]',
            '[class*="card"]',
            '[class*="activity"]',
            'a[href*="offer"]',
            'a[href*="search"]',
            'button[class*="card"]',
            '[data-testid*="card"]',
            '[data-component*="card"]'
        ]

        for (const selector of selectors) {
            try {
                const elements = Array.from(document.querySelectorAll(selector))

                for (const el of elements) {
                    const offerId =
                        el.getAttribute('data-offerid') ||
                        el.getAttribute('offerid') ||
                        el.getAttribute('data-activityid')

                    const href = el.getAttribute('href')
                    const className = el.className
                    const id = el.id
                    const tagName = el.tagName

                    // Get text content (cleaned)
                    const textContent = (el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 100)

                    // Get all data attributes
                    const dataAttrs = {}
                    Array.from(el.attributes)
                        .filter(attr => attr.name.startsWith('data-'))
                        .forEach(attr => (dataAttrs[attr.name] = attr.value))

                    // Only add if it looks like an activity item
                    if (
                        offerId ||
                        (href && (href.includes('rewards') || href.includes('bing'))) ||
                        (className && (className.includes('card') || className.includes('promo'))) ||
                        (textContent && textContent.includes('积分'))
                    ) {
                        items.push({
                            selector,
                            offerId,
                            href,
                            className,
                            id,
                            tagName,
                            textContent,
                            dataAttrs,
                            htmlPreview: el.outerHTML.substring(0, 800)
                        })
                    }
                }
            } catch {}
        }

        // Deduplicate by offerId or href
        const uniqueItems = []
        const seen = new Set()

        for (const item of items) {
            const key = item.offerId || item.href || item.className
            if (!seen.has(key)) {
                seen.add(key)
                uniqueItems.push(item)
            }
        }

        return uniqueItems
    })

    console.log(`\n[FOUND] ${activities.length} unique activity items`)

    if (activities.length > 0) {
        // Group by selector
        const bySelector = {}
        for (const item of activities) {
            if (!bySelector[item.selector]) bySelector[item.selector] = []
            bySelector[item.selector].push(item)
        }

        console.log('\n  Grouped by selector:')
        for (const [selector, items] of Object.entries(bySelector)) {
            console.log(`\n  ${selector}: ${items.length} items`)
            for (const item of items.slice(0, 3)) {
                console.log(`    - offerId: ${item.offerId || 'N/A'}`)
                console.log(`      href: ${item.href?.substring(0, 60) || 'N/A'}`)
                console.log(`      text: "${item.textContent?.substring(0, 50) || 'N/A'}"`)
                if (Object.keys(item.dataAttrs).length > 0) {
                    console.log(`      data-attrs: ${JSON.stringify(item.dataAttrs)}`)
                }
            }
        }

        // Save activities data
        fs.writeFileSync(path.join(projectRoot, 'debug-activities.json'), JSON.stringify(activities, null, 2))
        console.log('\n[SAVED] Activities data: debug-activities.json')

        // Save HTML for first 5 activities
        for (let i = 0; i < Math.min(activities.length, 5); i++) {
            const item = activities[i]
            if (item.htmlPreview) {
                const filename = `debug-activity-item-${i}.html`
                fs.writeFileSync(path.join(projectRoot, filename), item.htmlPreview)
                console.log(`[SAVED] Activity ${i} HTML: ${filename}`)
            }
        }
    } else {
        console.log('\n[WARN] No activity items found')
    }

    // Try to find the "Daily Set" or "每日任务" text directly
    console.log('\n[7] Searching for Daily Set text in page...')

    const dailySetTextElements = await page.evaluate(() => {
        const results = []

        // Find all elements containing "Daily Set" or "每日任务"
        const allElements = Array.from(document.querySelectorAll('*'))

        for (const el of allElements) {
            const text = el.textContent || ''

            if (
                text.includes('Daily Set') ||
                text.includes('每日任务') ||
                text.includes('每日活动') ||
                text.includes('任务')
            ) {
                // Skip if it's too large (like entire page)
                if (text.length < 200) {
                    results.push({
                        tagName: el.tagName,
                        className: el.className,
                        id: el.id,
                        text: text.trim(),
                        html: el.outerHTML
                    })
                }
            }
        }

        return results.slice(0, 10) // Limit to first 10
    })

    if (dailySetTextElements.length > 0) {
        console.log(`\n[FOUND] ${dailySetTextElements.length} elements with "Daily Set" text`)
        dailySetTextElements.forEach((el, i) => {
            console.log(`  ${i}. ${el.tagName} - class="${el.className}" id="${el.id}"`)
            console.log(`     Text: "${el.text}"`)
        })

        fs.writeFileSync(
            path.join(projectRoot, 'debug-dailyset-text-elements.json'),
            JSON.stringify(dailySetTextElements, null, 2)
        )
        console.log('[SAVED] Daily Set text elements: debug-dailyset-text-elements.json')
    }

    console.log('\n========================================')
    console.log('Analysis complete!')
    console.log('Browser stays open for manual inspection.')
    console.log('You can explore the dashboard structure yourself.')
    console.log('Press Ctrl+C to exit.')
    console.log('========================================')

    await new Promise(resolve => {
        process.on('SIGINT', resolve)
    })

    await browser.close()
}

main().catch(err => {
    console.error('\n[ERROR]', err)
    process.exit(1)
})
