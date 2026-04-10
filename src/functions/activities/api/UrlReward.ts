import type { AxiosRequestConfig } from 'axios'
import type { BasePromotion } from '../../../interface/DashboardData'
import { Workers } from '../../Workers'

export class UrlReward extends Workers {
    private cookieHeader: string = ''

    private fingerprintHeader: { [x: string]: string } = {}

    private gainedPoints: number = 0

    private oldBalance: number = this.bot.userData.currentPoints

    public async doUrlReward(promotion: BasePromotion) {
        if (!this.bot.requestToken && this.bot.rewardsVersion === 'legacy') {
            this.bot.logger.warn(
                this.bot.isMobile,
                'URL-REWARD',
                'Skipping: Request token not available, this activity requires it!'
            )
            return
        }

        const offerId = promotion.offerId

        this.bot.logger.info(
            this.bot.isMobile,
            'URL-REWARD',
            `Starting UrlReward | offerId=${offerId} | geo=${this.bot.userData.geoLocale} | oldBalance=${this.oldBalance}`
        )

        try {
            // Modern Dashboard: use browser automation instead of API
            if (this.bot.rewardsVersion === 'modern') {
                await this.doUrlRewardBrowser(promotion)
            } else {
                // Legacy Dashboard: use API
                await this.doUrlRewardApi(promotion)
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            const responseData = (error as any)?.response?.data

            this.bot.logger.error(
                this.bot.isMobile,
                'URL-REWARD',
                `Error in doUrlReward | offerId=${offerId} | message=${errorMsg}${responseData ? ` | response=${JSON.stringify(responseData).substring(0, 200)}` : ''}`
            )
        }
    }

    private async doUrlRewardBrowser(promotion: BasePromotion) {
        const offerId = promotion.offerId

        this.bot.logger.info(
            this.bot.isMobile,
            'URL-REWARD',
            `Modern Dashboard detected, using browser automation | offerId=${offerId}`
        )

        // Navigate to destination URL to trigger activity
        if (promotion.destinationUrl) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Navigating to destination | offerId=${offerId} | url=${promotion.destinationUrl}`
            )

            await this.bot.mainMobilePage
                .goto(promotion.destinationUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 20000
                })
                .catch(e => {
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'URL-REWARD',
                        `Navigation failed | offerId=${offerId} | error=${e instanceof Error ? e.message : String(e)}`
                    )
                })

            // Wait for page to load and track visit
            await this.bot.utils.wait(3000)

            // Scroll the page to simulate real user interaction
            await this.bot.mainMobilePage
                .evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight / 2)
                })
                .catch(() => {})

            await this.bot.utils.wait(2000)

            // Dismiss any popups
            await this.bot.browser.utils.tryDismissAllMessages(this.bot.mainMobilePage).catch(() => {})

            // Check points gain
            const newBalance = await this.bot.browser.func.getCurrentPoints()
            this.gainedPoints = newBalance - this.oldBalance

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Browser visit completed | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance} | gainedPoints=${this.gainedPoints}`
            )

            if (this.gainedPoints > 0) {
                this.bot.userData.currentPoints = newBalance
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + this.gainedPoints

                this.bot.logger.info(
                    this.bot.isMobile,
                    'URL-REWARD',
                    `Completed UrlReward via browser | offerId=${offerId} | gainedPoints=${this.gainedPoints} | newBalance=${newBalance}`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'URL-REWARD',
                    `No points gained from browser visit | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance}`
                )
            }

            // Return to rewards page
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
                'URL-REWARD',
                `No destinationUrl available | offerId=${offerId} | cannot complete via browser`
            )
        }

        await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))
    }

    private async doUrlRewardApi(promotion: BasePromotion) {
        const offerId = promotion.offerId

        this.cookieHeader = this.bot.browser.func.buildCookieHeader(
            this.bot.isMobile ? this.bot.cookies.mobile : this.bot.cookies.desktop,
            ['bing.com', 'live.com', 'microsoftonline.com']
        )

        const fingerprintHeaders = { ...this.bot.fingerprint.headers }
        delete fingerprintHeaders['Cookie']
        delete fingerprintHeaders['cookie']
        this.fingerprintHeader = fingerprintHeaders

        this.bot.logger.debug(
            this.bot.isMobile,
            'URL-REWARD',
            `Prepared UrlReward headers | offerId=${offerId} | cookieLength=${this.cookieHeader.length} | fingerprintHeaderKeys=${Object.keys(this.fingerprintHeader).length}`
        )

        const formDataObj: { [key: string]: string } = {
            id: offerId,
            hash: promotion.hash,
            timeZone: '60',
            activityAmount: '1',
            dbs: '0',
            form: '',
            type: ''
        }

        // Only add RequestVerificationToken for legacy dashboard
        if (this.bot.requestToken) {
            formDataObj['__RequestVerificationToken'] = this.bot.requestToken
        }

        const formData = new URLSearchParams(formDataObj)

        this.bot.logger.debug(
            this.bot.isMobile,
            'URL-REWARD',
            `Prepared UrlReward form data | offerId=${offerId} | hash=${promotion.hash} | timeZone=60 | activityAmount=1`
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
            'URL-REWARD',
            `Sending UrlReward request | offerId=${offerId} | url=${request.url}`
        )

        const response = await this.bot.axios.request(request)

        this.bot.logger.debug(
            this.bot.isMobile,
            'URL-REWARD',
            `Received UrlReward response | offerId=${offerId} | status=${response.status}`
        )

        const newBalance = await this.bot.browser.func.getCurrentPoints()
        this.gainedPoints = newBalance - this.oldBalance

        this.bot.logger.debug(
            this.bot.isMobile,
            'URL-REWARD',
            `Balance delta after UrlReward | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance} | gainedPoints=${this.gainedPoints}`
        )

        if (this.gainedPoints > 0) {
            this.bot.userData.currentPoints = newBalance
            this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + this.gainedPoints

            this.bot.logger.info(
                this.bot.isMobile,
                'URL-REWARD',
                `Completed UrlReward | offerId=${offerId} | status=${response.status} | gainedPoints=${this.gainedPoints} | newBalance=${newBalance}`,
                'green'
            )
        } else {
            this.bot.logger.warn(
                this.bot.isMobile,
                'URL-REWARD',
                `Failed UrlReward with no points | offerId=${offerId} | status=${response.status} | oldBalance=${this.oldBalance} | newBalance=${newBalance}`
            )
        }

        this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', `Waiting after UrlReward | offerId=${offerId}`)

        await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))
    }
}
