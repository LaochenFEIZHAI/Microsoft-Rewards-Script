import type { Page } from 'patchright'
import type { DashboardData } from '../../../interface/DashboardData'
import { Workers } from '../../Workers'

export class DailySetBrowser extends Workers {
    private oldBalance: number = 0

    public async doDailySetBrowser(data: DashboardData, page: Page) {
        const todayKey = this.bot.utils.getFormattedDate()
        const todayData = data.dailySetPromotions[todayKey]

        const activitiesUncompleted = todayData?.filter(x => !x?.complete && x.pointProgressMax > 0) ?? []

        if (!activitiesUncompleted.length) {
            this.bot.logger.info(
                this.bot.isMobile,
                'DAILY-SET-BROWSER',
                'All "Daily Set" items have already been completed'
            )
            return
        }

        this.oldBalance = this.bot.userData.currentPoints
        this.bot.logger.info(
            this.bot.isMobile,
            'DAILY-SET-BROWSER',
            `Starting Daily Set via browser automation | items=${activitiesUncompleted.length} | currentPoints=${this.oldBalance}`
        )

        // Navigate to dashboard (not baseURL which redirects to welcome)
        await page
            .goto('https://rewards.bing.com/dashboard', {
                waitUntil: 'domcontentloaded',
                timeout: 20000
            })
            .catch(() => {})

        await this.bot.utils.wait(5000)
        await this.bot.browser.utils.tryDismissAllMessages(page).catch(() => {})

        // Click "Earn more" button to expand all Daily Set activities
        await this.clickEarnMoreButton(page)

        await this.bot.utils.wait(3000)

        // Find Daily Set activity links on the page
        const dailySetLinks = await this.findDailySetLinks(page)

        if (dailySetLinks.length === 0) {
            this.bot.logger.warn(this.bot.isMobile, 'DAILY-SET-BROWSER', 'No Daily Set links found on dashboard page')
            return
        }

        this.bot.logger.info(
            this.bot.isMobile,
            'DAILY-SET-BROWSER',
            `Found ${dailySetLinks.length} Daily Set activities on dashboard`
        )

        // Process each activity
        for (let i = 0; i < dailySetLinks.length; i++) {
            const link = dailySetLinks[i]
            if (!link) continue

            this.bot.logger.info(
                this.bot.isMobile,
                'DAILY-SET-BROWSER',
                `Processing activity ${i + 1}/${dailySetLinks.length} | title="${link.title}" | type=${link.type}`
            )

            try {
                await this.processDailySetActivity(page, link)
                await this.bot.utils.wait(this.bot.utils.randomDelay(8000, 12000))
            } catch (error) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    `Failed to process activity | title="${link.title}" | error=${error instanceof Error ? error.message : String(error)}`
                )
            }

            // Return to dashboard
            await page
                .goto('https://rewards.bing.com/dashboard', {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000
                })
                .catch(() => {})

            await this.bot.utils.wait(3000)
        }

        // Check final points
        const newBalance = await this.bot.browser.func.getCurrentPoints()
        const gainedPoints = newBalance - this.oldBalance

        this.bot.logger.info(
            this.bot.isMobile,
            'DAILY-SET-BROWSER',
            `Completed Daily Set | gainedPoints=${gainedPoints} | oldBalance=${this.oldBalance} | newBalance=${newBalance}`,
            gainedPoints > 0 ? 'green' : undefined
        )

        this.bot.userData.currentPoints = newBalance
        this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints
    }

    private async clickEarnMoreButton(page: Page) {
        try {
            this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET-BROWSER', 'Looking for "Earn more" button')

            // Try multiple selectors for the "Earn more" button/link
            const earnMoreSelectors = [
                'a[href="/earn"]',
                'a[href*="/earn"]',
                'a:has-text("Earn more")',
                'button:has-text("Earn more")',
                '[aria-label*="Earn more"]',
                'a:text-is("Earn more")'
            ]

            for (const selector of earnMoreSelectors) {
                try {
                    const element = page.locator(selector).first()

                    if (await element.isVisible({ timeout: 2000 })) {
                        this.bot.logger.info(
                            this.bot.isMobile,
                            'DAILY-SET-BROWSER',
                            'Clicking "Earn more" button to expand Daily Set activities'
                        )

                        await element.click({ timeout: 5000 })

                        // Wait for content to expand
                        await this.bot.utils.wait(3000)

                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'DAILY-SET-BROWSER',
                            '"Earn more" clicked, waiting for activities to expand'
                        )

                        return
                    }
                } catch (e) {
                    // Continue to next selector
                }
            }

            // If no selector worked, try to find by text content
            const earnMoreByText = await page.evaluate(() => {
                const allLinks = Array.from(document.querySelectorAll('a, button'))
                const earnMoreElement = allLinks.find(el => {
                    const text = (el.textContent || '').toLowerCase().trim()
                    return text === 'earn more' || text.includes('earn more')
                })

                return earnMoreElement
                    ? {
                          found: true,
                          tagName: earnMoreElement.tagName,
                          className: earnMoreElement.className
                      }
                    : { found: false }
            })

            if (earnMoreByText.found) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    'Found "Earn more" by text search, clicking...'
                )

                // Try to click it using the text
                await page
                    .locator('a:has-text("Earn more"), button:has-text("Earn more")')
                    .first()
                    .click({ timeout: 5000 })
                await this.bot.utils.wait(3000)
            } else {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    '"Earn more" button not found, continuing with visible activities'
                )
            }
        } catch (error) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'DAILY-SET-BROWSER',
                `Error clicking "Earn more": ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private async findDailySetLinks(
        page: Page
    ): Promise<Array<{ href: string; title: string; type: 'search' | 'quiz'; selector: string }>> {
        const links: Array<{ href: string; title: string; type: 'search' | 'quiz'; selector: string }> = []

        try {
            // Find all links that look like Daily Set activities
            const linkElements = await page.evaluate(() => {
                const results = []

                // Find all <a> tags with href containing search or rewards
                const allLinks = Array.from(document.querySelectorAll('a[href]'))

                for (const link of allLinks) {
                    const href = link.getAttribute('href') || ''
                    const className = link.className || ''

                    // Check if this is a Daily Set activity link
                    if (
                        href.includes('rnoreward=1') ||
                        href.includes('Gamification_DailySet') ||
                        href.includes('BTDSUOID') ||
                        (href.includes('bing.com/search') && className.includes('mai:rounded-cornerCardDefault'))
                    ) {
                        // Get title from the link or its children
                        const titleElement =
                            link.querySelector('p[class*="subtitle"], p[class*="title"], h3, h4') || link
                        const title = (titleElement.textContent || '').trim().split('\n')[0] || 'Unknown'

                        // Determine type
                        const isQuiz = href.includes('filters=IsConversation') || href.includes('form=dsetqu')

                        results.push({
                            href,
                            title: title.substring(0, 50),
                            type: isQuiz ? 'quiz' : 'search',
                            className,
                            selector: `a[href*="${href.substring(0, 50)}"]`
                        })
                    }
                }

                return results
            })

            for (const el of linkElements) {
                links.push({
                    href: el.href,
                    title: el.title,
                    type: el.type as 'search' | 'quiz',
                    selector: el.selector
                })

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    `Found Daily Set link | title="${el.title}" | type=${el.type} | href=${el.href.substring(0, 80)}`
                )
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'DAILY-SET-BROWSER',
                `Error finding Daily Set links: ${error instanceof Error ? error.message : String(error)}`
            )
        }

        return links
    }

    private async processDailySetActivity(
        page: Page,
        link: { href: string; title: string; type: 'search' | 'quiz'; selector: string }
    ) {
        try {
            // Click the activity link (opens in new tab)
            this.bot.logger.debug(
                this.bot.isMobile,
                'DAILY-SET-BROWSER',
                `Clicking activity link | title="${link.title}"`
            )

            // Navigate directly to the href instead of clicking (more reliable)
            await page.goto(link.href, {
                waitUntil: 'domcontentloaded',
                timeout: 20000
            })

            await this.bot.utils.wait(4000)

            // For search activities: just stay on page and scroll
            if (link.type === 'search') {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    `Search activity - staying on page | title="${link.title}"`
                )

                await this.scrollPage(page)
                await this.bot.utils.wait(3000)
            }

            // For quiz activities: answer the questions
            if (link.type === 'quiz') {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    `Quiz activity - answering questions | title="${link.title}"`
                )

                await this.handleQuiz(page)
            }

            // Check points after completing activity
            const newBalance = await this.bot.browser.func.getCurrentPoints()
            const gained = newBalance - this.oldBalance

            if (gained > 0) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    `Activity completed successfully | title="${link.title}" | gained=${gained} points`,
                    'green'
                )
                this.oldBalance = newBalance
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    `Activity may not have completed | title="${link.title}" | no points gained yet`
                )
            }
        } catch (error) {
            throw error
        }
    }

    private async handleQuiz(page: Page) {
        await this.bot.utils.wait(3000)
        await this.bot.browser.utils.tryDismissAllMessages(page).catch(() => {})

        // Try to answer quiz questions (up to 5 questions)
        const maxQuestions = 5
        for (let q = 0; q < maxQuestions; q++) {
            try {
                await this.bot.utils.wait(2000)

                // Try multiple selectors for quiz options
                const optionSelectors = [
                    '.quiz-option',
                    '.quiz-option-button',
                    'button[class*="option"]',
                    '[data-testid="option"]',
                    'input[type="radio"]',
                    '.b_quizQuestionOption'
                ]

                let answered = false
                for (const selector of optionSelectors) {
                    try {
                        const options = page.locator(selector)
                        const count = await options.count()

                        if (count > 0) {
                            // Click random option (quiz doesn't care about correct answers)
                            const randomIndex = Math.floor(Math.random() * count)
                            await options.nth(randomIndex).click({ timeout: 5000 })

                            this.bot.logger.debug(
                                this.bot.isMobile,
                                'DAILY-SET-BROWSER',
                                `Answered quiz question ${q + 1} | selector=${selector} | option=${randomIndex}`
                            )

                            answered = true
                            await this.bot.utils.wait(1500)
                            break
                        }
                    } catch {}
                }

                if (!answered) {
                    // Check if quiz is complete or submit button available
                    const completeIndicators = await page
                        .locator('.quiz-complete, .quiz-done, [data-testid="quiz-complete"]')
                        .count()

                    if (completeIndicators > 0) {
                        this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET-BROWSER', 'Quiz completed')
                        break
                    }

                    // Try submit button
                    const submitSelectors = ['button[type="submit"]', '.submit-button', '[data-testid="submit"]']

                    for (const selector of submitSelectors) {
                        try {
                            const submitBtn = page.locator(selector).first()
                            if (await submitBtn.isVisible({ timeout: 2000 })) {
                                await submitBtn.click({ timeout: 3000 })
                                await this.bot.utils.wait(1000)
                                break
                            }
                        } catch {}
                    }
                }
            } catch (error) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    `Quiz question ${q + 1} handling error: ${error instanceof Error ? error.message : String(error)}`
                )
            }
        }

        await this.bot.utils.wait(3000)
    }

    private async scrollPage(page: Page) {
        try {
            // Scroll to simulate user interaction
            await page
                .evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight / 3)
                })
                .catch(() => {})

            await this.bot.utils.wait(1500)

            await page
                .evaluate(() => {
                    window.scrollTo(0, (document.body.scrollHeight * 2) / 3)
                })
                .catch(() => {})

            await this.bot.utils.wait(1500)

            // Scroll back to top
            await page
                .evaluate(() => {
                    window.scrollTo(0, 0)
                })
                .catch(() => {})

            await this.bot.utils.wait(1000)
        } catch {}
    }
}
