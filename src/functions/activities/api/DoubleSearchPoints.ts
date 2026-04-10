import type { AxiosRequestConfig } from 'axios'
import { Workers } from '../../Workers'
import { PromotionalItem } from '../../../interface/DashboardData'

export class DoubleSearchPoints extends Workers {
    private cookieHeader: string = ''

    private fingerprintHeader: { [x: string]: string } = {}

    public async doDoubleSearchPoints(promotion: PromotionalItem) {
        const offerId = promotion.offerId

        try {
            // Modern Dashboard: use browser automation instead of API
            if (this.bot.rewardsVersion === 'modern') {
                await this.doDoubleSearchPointsBrowser(promotion)
            } else {
                // Legacy Dashboard: use API
                await this.doDoubleSearchPointsApi(promotion)
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Error in doDoubleSearchPoints | offerId=${offerId} | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private async doDoubleSearchPointsBrowser(promotion: PromotionalItem) {
        const offerId = promotion.offerId

        this.bot.logger.info(
            this.bot.isMobile,
            'DOUBLE-SEARCH-POINTS',
            `Modern Dashboard detected, using browser automation | offerId=${offerId}`
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

            // Try to find and click opt-in button
            const possibleSelectors = [
                'button[data-testid="optin"]',
                '.optin-button',
                'button[class*="optin"]',
                'a[class*="optin"]',
                '[data-testid="accept-button"]'
            ]

            for (const selector of possibleSelectors) {
                try {
                    const element = this.bot.mainMobilePage.locator(selector).first()
                    if (await element.isVisible({ timeout: 2000 })) {
                        await this.bot.browser.utils.ghostClick(this.bot.mainMobilePage, selector)
                        await this.bot.utils.wait(2000)
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'DOUBLE-SEARCH-POINTS',
                            `Clicked optin button | selector=${selector}`
                        )
                        break
                    }
                } catch {}
            }

            await this.bot.browser.utils.tryDismissAllMessages(this.bot.mainMobilePage).catch(() => {})

            // Check if activated by checking dashboard data
            const data = await this.bot.browser.func.getDashboardData()
            const promotionalItem = data.promotionalItems?.find(item =>
                item.name.toLowerCase().includes('ww_banner_optin_2x')
            )

            if (!promotionalItem) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'DOUBLE-SEARCH-POINTS',
                    `Activated Double Search Points via browser | offerId=${offerId}`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'DOUBLE-SEARCH-POINTS',
                    `Unable to activate Double Search Points | offerId=${offerId}`
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
            this.bot.logger.warn(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `No destinationUrl available | offerId=${offerId}`
            )
        }

        await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))
    }

    private async doDoubleSearchPointsApi(promotion: PromotionalItem) {
        const offerId = promotion.offerId
        const activityType = promotion.activityType

        if (!this.bot.requestToken && this.bot.rewardsVersion === 'legacy') {
            this.bot.logger.warn(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
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
            'DOUBLE-SEARCH-POINTS',
            `Starting Double Search Points | offerId=${offerId}`
        )

        this.bot.logger.debug(
            this.bot.isMobile,
            'DOUBLE-SEARCH-POINTS',
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
            'DOUBLE-SEARCH-POINTS',
            `Prepared Double Search Points form data | offerId=${offerId} | hash=${promotion.hash} | timeZone=60 | activityAmount=1 | type=${activityType}`
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
            'DOUBLE-SEARCH-POINTS',
            `Sending Double Search Points request | offerId=${offerId} | url=${request.url}`
        )

        const response = await this.bot.axios.request(request)

        this.bot.logger.debug(
            this.bot.isMobile,
            'DOUBLE-SEARCH-POINTS',
            `Received Double Search Points response | offerId=${offerId} | status=${response.status}`
        )

        const data = await this.bot.browser.func.getDashboardData()
        const promotionalItem = data.promotionalItems?.find(item =>
            item.name.toLowerCase().includes('ww_banner_optin_2x')
        )

        // If OK, should no longer be present in promotionalItems
        if (promotionalItem) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Unable to find or activate Double Search Points | offerId=${offerId} | status=${response.status}`
            )
        } else {
            this.bot.logger.info(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Activated Double Search Points | offerId=${offerId} | status=${response.status}`,
                'green'
            )
        }

        this.bot.logger.debug(
            this.bot.isMobile,
            'DOUBLE-SEARCH-POINTS',
            `Waiting after Double Search Points | offerId=${offerId}`
        )

        await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))
    }
}
