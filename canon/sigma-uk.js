import * as feeding from './../util/feeding.js';
import * as caching from './../util/caching.js';
import { shortDateTime } from '../static/datetime.js';

const sourceFeed = 'https://sigmauk.com/feed';   // Alternatively US: https://press.sigmaphoto.com/feed/ ?
const sourceLabel = 'SIGMAUK';
const cacheId = 'sigmauk-cache';
const cacheMinutes = 120;
const feedLength = 12;

const matchCanonRegex = feeding.wordMatchRegex('canon');
const matchRfRegex = feeding.wordMatchRegex('rf');
const matchRfMountRegex = feeding.wordMatchRegex('rf-mount');

/**
 * Unwanted categories of posts to be ignored (lowercase)
 * @type {string[]}
 */
const skipCategories = [
    // for future categories to ignore?
];

/**
 * Returns a filtered list of items looking related to Canon
 * @param items {Object[]}
 * @param [maxLength=feedLength] {number} - maximum number of items to return, defaults to feedLength
 * @returns {Object[]}
 */
function filteredAndTweakedItemList(items, maxLength = feedLength) {
    const filteredList = [];
    for (const item of items) {
        const title = item.title ?? '';
        const description = item.description ?? '';
        const content = item.content?.encoded ?? '';
        const hasCanonReference = // content === '' || // if no content, then we are *probably* looking at a cached item already been identified as canon-related
            matchCanonRegex.test(title) || matchRfRegex.test(title) || matchRfMountRegex.test(title)
            || matchCanonRegex.test(description) || matchRfRegex.test(description) || matchRfMountRegex.test(description)
            || matchCanonRegex.test(content) || matchRfRegex.test(content) || matchRfMountRegex.test(content);
        if (hasCanonReference && (filteredList.length < maxLength)) {
            const imgSrc = feeding.findImageSrc(content);
            if (imgSrc) {
                item._image = imgSrc;
            }
            delete item.content; // Remove the (typically) very big content.encoded field, leaving only the shorter description field.
            filteredList.push(item);
        }
    }
    return filteredList;
}

/**
 * Returns a list of relevant (filtered) feed items
 * @returns {Promise<Object[]>}
 */
async function feedItems() {
    const feedRequestTime = new Date();
    let cachedTime = new Date('2000-01-01');
    let cachedItems = [];
    const cached = await caching.get(cacheId);
    if (cached?.cachedTime) {
        cachedTime = new Date(cached.cachedTime);
    }
    if (cached?.cachedItems) {
        cachedItems = cached.cachedItems; // already filtered and tweaked ()
    }
    // console.log(` 🤖 CACHED CONTENT FROM ${cachedTime} WAS READ`);

    if (cachedItems?.length && ((feedRequestTime.getTime() - cachedTime.getTime()) < (cacheMinutes * 60 * 1000))) {
        console.log(` 🤖 For ${sourceLabel}, just use the recently updated (${shortDateTime(cachedTime,'shortOffset')}) CACHED ITEMS`);
        return cachedItems;
    }

    const sourceItems = await feeding.getParsedSourceItems(sourceFeed);
    let relevantItems = [];
    if (sourceItems?.length) {
        relevantItems = filteredAndTweakedItemList(sourceItems);
    }

    for (const item of cachedItems) {
        if (!relevantItems.some(relevant => relevant.guid?.value === item.guid?.value)) {
            relevantItems.push(item);
        }
    }
    if (relevantItems.length) {
        if (feeding.arraysDiffers(relevantItems, cachedItems)) {
            if (relevantItems.length > cachedItems.length) {
                console.log(` 🌟 New item(s) was added to the ${sourceLabel} feed!`);
            }
            let cached = {};
            try {
                cached = await caching.set(cacheId, {
                    cachedTime: feedRequestTime,
                    cachedItems: relevantItems.slice(0, feedLength)
                });
            } catch (err) {
                console.error(` 💣 Error when trying to update cache for ${sourceLabel}!`, err);
            }
            if (cached?.ok) {
                console.log(` 🤖 Cache for ${sourceLabel} was ${sourceItems?.length ? 'updated' : '"extended"'}. ${cached.info}.`);
            } else {
                console.warn(` 💣 Failed updating cache for ${sourceLabel}!`)
            }
        } else {
            // temp log unnecessary write skipped
            console.info(`SKIPPED UNNECESSARY CACHE WRITE for ${sourceLabel}.`)
        }
    }
    return relevantItems;
}

/**
 * Returns a filtered feed
 * @param feedType {'json'|'rss'}
 * @param reqHeaders {Headers}
 * @param [info] {ServeHandlerInfo<Addr>}
 * @param [logging=false] {boolean} - if true, potentially extra logging for debugging
 * @returns {Promise<{body: string, options: {status: number, statusText: string, headers: Headers}}>}
 */
export async function sigmaUK(feedType, reqHeaders, info, logging = false) {

    const CreateFeedTool = feeding.getCreateFeedTool(
        feedType,
        'Sigma UK - Canon related post only',
        'This is a filtered version of the official news feed from Sigma UK with only the Canon related posts.',
        `${feeding.DeployedAt}/canon/sigmaukfeed.${feedType}`,
        'https://sigmauk.com/category/discover/news',
        'Sigma UK',
        'https://sigmauk.com/wp-content/uploads/2025/02/SIGMA_Wordmark_Black_RGB.svg',
        'daily',
        6 // every four hours
    );

    const origin = reqHeaders.get('Origin');
    const respHeaders = new Headers({'Content-Type': CreateFeedTool.contentType});
    if (origin && feeding.isAllowedForCors(origin)) {
        respHeaders.set('Access-Control-Allow-Origin', origin);
        respHeaders.set('Vary', 'Origin');
    }
    const feedData = CreateFeedTool.template;
    const latestRelevantItems = await feedItems();
    for (const item of latestRelevantItems) {
        feedData.items.push(CreateFeedTool.createItem(item));
    }
    const responseBody = CreateFeedTool.createResponseBody(feedData, { lenient: true });
    return {
        body: responseBody,
        options: {
            status: 200,
            statusText: 'OK',
            headers: respHeaders
        }
    };

}
