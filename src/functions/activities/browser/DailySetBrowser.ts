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
            `Starting Daily Set | items=${activitiesUncompleted.length} | currentPoints=${this.oldBalance}`
        )

        // Navigate to dashboard
        await page
            .goto('https://rewards.bing.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 20000 })
            .catch(() => {})
        await this.bot.utils.wait(5000)
        await this.bot.browser.utils.tryDismissAllMessages(page).catch(() => {})

        // Click "Earn more" button to expand
        await this.clickEarnMoreButton(page)
        await this.bot.utils.wait(4000)

        // Process each activity by clicking cards (human-like)
        for (let i = 0; i < activitiesUncompleted.length; i++) {
            try {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    `Processing activity ${i + 1}/${activitiesUncompleted.length}`
                )
                await this.processActivityByClicking(page)
                await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 8000))
            } catch (error) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'DAILY-SET-BROWSER',
                    `Failed activity ${i + 1} | error=${error instanceof Error ? error.message : String(error)}`
                )
            }
        }

        // Check final points
        const newBalance = await this.bot.browser.func.getCurrentPoints()
        const gainedPoints = newBalance - this.oldBalance

        this.bot.logger.info(
            this.bot.isMobile,
            'DAILY-SET-BROWSER',
            `Completed Daily Set | gained=${gainedPoints} | old=${this.oldBalance} | new=${newBalance}`,
            gainedPoints > 0 ? 'green' : undefined
        )

        this.bot.userData.currentPoints = newBalance
        this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints
    }

    private async clickEarnMoreButton(page: Page) {
        try {
            const earnMoreLink = page.locator('a[href="/earn"], a:has-text("Earn more")').first()
            if (await earnMoreLink.isVisible({ timeout: 3000 })) {
                this.bot.logger.info(this.bot.isMobile, 'DAILY-SET-BROWSER', 'Clicking "Earn more"')
                await earnMoreLink.click({ timeout: 5000 })
                await this.bot.utils.wait(3000)
            }
        } catch {
            this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET-BROWSER', '"Earn more" not found')
        }
    }

    private async processActivityByClicking(page: Page) {
        // Find activity cards
        const activityCards = await this.findActivityCards(page)
        if (activityCards.length === 0) {
            this.bot.logger.warn(this.bot.isMobile, 'DAILY-SET-BROWSER', 'No activity cards found')
            return
        }

        const card = activityCards[0]
        if (!card) return

        this.bot.logger.info(
            this.bot.isMobile,
            'DAILY-SET-BROWSER',
            `Clicking card | title="${card.title}" | type=${card.type}`
        )

        // Click the card (human-like behavior)
        await card.element.click({ timeout: 10000 })
        await this.bot.utils.wait(3000)

        // Check for new tab
        const context = page.context()
        const pages = context.pages()

        if (pages.length > 1) {
            // Work in new tab
            const newPage = pages[pages.length - 1]
            if (!newPage) return

            this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET-BROWSER', 'New tab opened')
            await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
            await this.bot.utils.wait(4000)

            if (card.type === 'quiz') {
                await this.handleQuizActivity(newPage)
            } else {
                await this.handleSearchActivity(newPage)
            }

            await newPage.close().catch(() => {})
            await this.bot.utils.wait(2000)
        } else {
            // Same page
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {})
            await this.bot.utils.wait(4000)

            if (card.type === 'quiz') {
                await this.handleQuizActivity(page)
            } else {
                await this.handleSearchActivity(page)
            }

            // Back to dashboard
            await page
                .goto('https://rewards.bing.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 15000 })
                .catch(() => {})
            await this.bot.utils.wait(3000)
        }

        // Check points
        const newBalance = await this.bot.browser.func.getCurrentPoints()
        const gained = newBalance - this.oldBalance
        if (gained > 0) {
            this.bot.logger.info(this.bot.isMobile, 'DAILY-SET-BROWSER', `Activity done | gained=${gained}`, 'green')
            this.oldBalance = newBalance
        }
    }

    private async findActivityCards(
        page: Page
    ): Promise<Array<{ element: any; title: string; type: 'search' | 'quiz' }>> {
        const cards: Array<{ element: any; title: string; type: 'search' | 'quiz' }> = []

        try {
            const locator = page.locator(
                'a[href*="rnoreward=1"], a[href*="Gamification_DailySet"], a[href*="form=dsetqu"]'
            )
            const count = await locator.count()

            this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET-BROWSER', `Found ${count} activity elements`)

            for (let i = 0; i < count; i++) {
                try {
                    const element = locator.nth(i)
                    const href = (await element.getAttribute('href')) || ''
                    const titleText = (await element.textContent()) || ''
                    const title = (titleText.trim().split('\n')[0] || '').substring(0, 40) || `Activity ${i + 1}`
                    const isQuiz = href.includes('filters=IsConversation') || href.includes('form=dsetqu')

                    if (await element.isVisible({ timeout: 2000 })) {
                        cards.push({ element, title, type: isQuiz ? 'quiz' : 'search' })
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'DAILY-SET-BROWSER',
                            `Card ${i + 1} | title="${title}" | type=${isQuiz ? 'quiz' : 'search'}`
                        )
                    }
                } catch {
                    continue
                }
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'DAILY-SET-BROWSER',
                `Error finding cards: ${error instanceof Error ? error.message : String(error)}`
            )
        }

        return cards
    }

    private async handleSearchActivity(page: Page) {
        this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET-BROWSER', 'Search activity - staying on page')
        await this.bot.utils.wait(3000)

        // Scroll (human-like)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {})
        await this.bot.utils.wait(2000)
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
        await this.bot.utils.wait(2000)
    }

    private async handleQuizActivity(page: Page) {
        this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET-BROWSER', 'Quiz activity')
        await this.bot.utils.wait(4000)
        await this.bot.browser.utils.tryDismissAllMessages(page).catch(() => {})

        // Answer questions (usually 3)
        for (let q = 0; q < 5; q++) {
            await this.bot.utils.wait(3000)

            const optionLocator = page.locator('button[class*="option"], input[type="radio"], .quiz-option')
            const optionsCount = await optionLocator.count()

            if (optionsCount > 0) {
                await optionLocator.first().click({ timeout: 5000 })
                this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET-BROWSER', `Answered question ${q + 1}`)
                await this.bot.utils.wait(2000)

                const submitButton = page.locator('button[type="submit"]').first()
                if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await submitButton.click({ timeout: 5000 })
                    await this.bot.utils.wait(2000)
                }
            } else {
                const completeIndicator = await page.locator('.quiz-complete').count()
                if (completeIndicator > 0) {
                    this.bot.logger.debug(this.bot.isMobile, 'DAILY-SET-BROWSER', 'Quiz completed')
                    break
                }
            }
        }
    }
}
