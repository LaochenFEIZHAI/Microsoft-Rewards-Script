import type { AxiosRequestConfig } from 'axios'
import type { FindClippyPromotion } from '../../../interface/DashboardData'
import { Workers } from '../../Workers'

export class FindClippy extends Workers {
    private cookieHeader: string = ''

    private fingerprintHeader: { [x: string]: string } = {}

    private gainedPoints: number = 0

    private oldBalance: number = this.bot.userData.currentPoints

    public async doFindClippy(promotion: FindClippyPromotion) {
        const offerId = promotion.offerId

        try {
            // Modern Dashboard: use browser automation instead of API
            if (this.bot.rewardsVersion === 'modern') {
                await this.doFindClippyBrowser(promotion)
            } else {
                // Legacy Dashboard: use API
                await this.doFindClippyApi(promotion)
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'FIND-CLIPPY',
                `Error in doFindClippy | offerId=${offerId} | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private async doFindClippyBrowser(promotion: FindClippyPromotion) {
        const offerId = promotion.offerId
        const activityType = promotion.activityType

        this.bot.logger.info(
            this.bot.isMobile,
            'FIND-CLIPPY',
            `Modern Dashboard detected, using browser automation | offerId=${offerId} | activityType=${activityType} | oldBalance=${this.oldBalance}`
        )

        // Navigate to destination URL if available
        if (promotion.destinationUrl) {
            await this.bot.mainMobilePage
                .goto(promotion.destinationUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 20000
                })
                .catch(() => {})

            await this.bot.utils.wait(3000)

            // Try to find and click on the clippy icon or similar elements
            const possibleSelectors = [
                '.clippy-icon',
                '.reward-icon',
                '[data-testid="clippy"]',
                'img[src*="clippy"]',
                '.bing-reward-icon'
            ]

            for (const selector of possibleSelectors) {
                try {
                    const element = this.bot.mainMobilePage.locator(selector).first()
                    if (await element.isVisible({ timeout: 2000 })) {
                        await this.bot.browser.utils.ghostClick(this.bot.mainMobilePage, selector)
                        await this.bot.utils.wait(2000)
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'FIND-CLIPPY',
                            `Clicked element | selector=${selector}`
                        )
                        break
                    }
                } catch {}
            }

            await this.bot.browser.utils.tryDismissAllMessages(this.bot.mainMobilePage).catch(() => {})

            const newBalance = await this.bot.browser.func.getCurrentPoints()
            this.gainedPoints = newBalance - this.oldBalance

            this.bot.logger.debug(
                this.bot.isMobile,
                'FIND-CLIPPY',
                `Browser visit completed | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance} | gainedPoints=${this.gainedPoints}`
            )

            if (this.gainedPoints > 0) {
                this.bot.userData.currentPoints = newBalance
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + this.gainedPoints

                this.bot.logger.info(
                    this.bot.isMobile,
                    'FIND-CLIPPY',
                    `Found Clippy via browser | offerId=${offerId} | gainedPoints=${this.gainedPoints} | newBalance=${newBalance}`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'FIND-CLIPPY',
                    `No points gained | offerId=${offerId} | activityType=${activityType} | oldBalance=${this.oldBalance} | newBalance=${newBalance}`
                )
            }

            await this.bot.mainMobilePage
                .goto(this.bot.config.baseURL, {
                    waitUntil: 'domcontentloaded',
                    timeout: 10000
                })
                .catch(() => {})

            await this.bot.utils.wait(2000)
        } else {
            this.bot.logger.warn(this.bot.isMobile, 'FIND-CLIPPY', `No destinationUrl available | offerId=${offerId}`)
        }

        await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))
    }

    private async doFindClippyApi(promotion: FindClippyPromotion) {
        const offerId = promotion.offerId
        const activityType = promotion.activityType

        if (!this.bot.requestToken && this.bot.rewardsVersion === 'legacy') {
            this.bot.logger.warn(
                this.bot.isMobile,
                'FIND-CLIPPY',
                'Skipping: Request token not available, this activity requires it!'
            )
            return
        }

        this.cookieHeader = this.bot.browser.func.buildCookieHeader(
            this.bot.isMobile ? this.bot.cookies.mobile : this.bot.cookies.desktop,
            ['bing.com', 'live.com', 'microsoftonline.com']
        )

        const fingerprintHeaders = { ...this.bot.fingerprint.headers }
        delete fingerprintHeaders['Cookie']
        delete fingerprintHeaders['cookie']
        this.fingerprintHeader = fingerprintHeaders

        this.bot.logger.info(
            this.bot.isMobile,
            'FIND-CLIPPY',
            `Starting Find Clippy | offerId=${offerId} | activityType=${activityType} | oldBalance=${this.oldBalance}`
        )

        this.bot.logger.debug(
            this.bot.isMobile,
            'FIND-CLIPPY',
            `Prepared headers | cookieLength=${this.cookieHeader.length} | fingerprintHeaderKeys=${Object.keys(this.fingerprintHeader).length}`
        )

        const formDataObj: { [key: string]: string } = {
            id: offerId,
            hash: promotion.hash,
            timeZone: '60',
            activityAmount: '1',
            dbs: '0',
            form: '',
            type: activityType
        }

        // Only add RequestVerificationToken for legacy dashboard
        if (this.bot.requestToken) {
            formDataObj['__RequestVerificationToken'] = this.bot.requestToken
        }

        const formData = new URLSearchParams(formDataObj)

        this.bot.logger.debug(
            this.bot.isMobile,
            'FIND-CLIPPY',
            `Prepared Find Clippy form data | offerId=${offerId} | hash=${promotion.hash} | timeZone=60 | activityAmount=1 | type=${activityType}`
        )

        const request: AxiosRequestConfig = {
            url: 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest',
            method: 'POST',
            headers: {
                ...(this.bot.fingerprint?.headers ?? {}),
                Cookie: this.cookieHeader,
                Referer: 'https://rewards.bing.com/',
                Origin: 'https://rewards.bing.com'
            },
            data: formData
        }

        this.bot.logger.debug(
            this.bot.isMobile,
            'FIND-CLIPPY',
            `Sending Find Clippy request | offerId=${offerId} | url=${request.url}`
        )

        const response = await this.bot.axios.request(request)

        this.bot.logger.debug(
            this.bot.isMobile,
            'FIND-CLIPPY',
            `Received Find Clippy response | offerId=${offerId} | status=${response.status}`
        )

        const newBalance = await this.bot.browser.func.getCurrentPoints()
        this.gainedPoints = newBalance - this.oldBalance

        this.bot.logger.debug(
            this.bot.isMobile,
            'FIND-CLIPPY',
            `Balance delta after Find Clippy | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance} | gainedPoints=${this.gainedPoints}`
        )

        if (this.gainedPoints > 0) {
            this.bot.userData.currentPoints = newBalance
            this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + this.gainedPoints

            this.bot.logger.info(
                this.bot.isMobile,
                'FIND-CLIPPY',
                `Found Clippy | offerId=${offerId} | status=${response.status} | gainedPoints=${this.gainedPoints} | newBalance=${newBalance}`,
                'green'
            )
        } else {
            this.bot.logger.warn(
                this.bot.isMobile,
                'FIND-CLIPPY',
                `Found Clippy but no points were gained | offerId=${offerId} | status=${response.status} | oldBalance=${this.oldBalance} | newBalance=${newBalance}`
            )
        }

        this.bot.logger.debug(this.bot.isMobile, 'FIND-CLIPPY', `Waiting after Find Clippy | offerId=${offerId}`)

        await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))
    }
}
