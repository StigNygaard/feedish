import * as feeding from './../util/feeding.js';
import * as caching from './../util/caching.js';
import {shortDateTime} from "../static/datetime.js";

// XenForo forum system

const sourceFeed = 'https://www.canonrumors.com/forum/forums/-/index.rss?order=post_date';
const sourceLabel = 'CRFORUM';
const cacheId = 'crforum-cache';
const cacheMinutes = 60;
const feedLength = 12;

/**
 * Tries to detect if an item is a comment-thread for a post on the main site.
 * Unfortunately, it is not exact science when based on only the content of the feed only.
 * @param item
 * @returns {boolean}
 */
function isCommentThread(item) {
    return /full\sarticle\s?(\.\.\.)?<\/a><\/div>$/i.test(item.content?.encoded?.trim())
        || (item.authors?.at(0)?.endsWith('(Richard CR)'));
}

/**
 * Returns a filtered list of new threads (topics) in forum, trying to avoid the
 * threads created to be a comment-section for a post on the main-site.
 * @param items
 * @param [maxLength=feedLength] {number} - maximum number of items to return, defaults to feedLength
 * @returns {Object[]}
 */
function filteredItemList(items, maxLength = feedLength) {
    const filteredList = [];
    for (const item of items) {
        if (!isCommentThread(item)) {
            if (filteredList.length < maxLength) filteredList.push(item);
        }
    }
    return filteredList;
}

/**
 * Removes "read more" links
 * @param items {Object[]}
 * @returns {Object[]} */
function tweakItems(items) {
    for (const item of items) {
        if (item.content?.encoded) {
            item.content.encoded = item.content.encoded.replace(
                /<a\s+href="https:\/\/www\.canonrumors\.com\/forum\/threads\/[a-zA-Z0-9./_-]+"\s+class="link\s+link--internal">Read\s+more<\/a><\/div>$/,
                '</div>'
            );
        }
    }
    return items;
}

/**
 * Returns a list of relevant/filtered feed items for CR FORUM
 * @returns {Promise<Object[]>}
 */
async function feedItems() {
    const feedRequestTime = new Date();
    let cachedTime = new Date('2000-01-01');
    let finalItems = [];
    const cached = await caching.get(cacheId);
    if (cached?.cachedTime) {
        cachedTime = new Date(cached.cachedTime);
    }
    if (cached?.cachedItems) {
        finalItems = tweakItems(filteredItemList(cached.cachedItems));
    }
    // console.log(` 🤖 CACHED FORUM-CONTENT FROM ${cachedTime} WAS READ. There was ${finalItems?.length} cached items.`);

    if (finalItems?.length && ((feedRequestTime.getTime() - cachedTime.getTime()) < (cacheMinutes * 60 * 1000))) {
        console.log(` 🤖 For ${sourceLabel}, just use the recently updated (${shortDateTime(cachedTime,'shortOffset')}) CACHED ITEMS`);
        return finalItems;
    }
    const highestGuid = finalItems.length ? finalItems[0].guid.value : 0;

    const sourceItems = await feeding.getParsedSourceItems(sourceFeed);
    let relevantSourceItems = [];
    if (sourceItems?.length) {
        sourceItems.sort((a, b) => {
            const va = Number(a.guid?.value);
            const vb = Number(b.guid?.value);
            return (Number.isNaN(vb) ? 0 : vb) - (Number.isNaN(va) ? 0 : va)
        });

        // console.log('\nsourceItems:\n', JSON.stringify(sourceItems));

        relevantSourceItems = tweakItems(filteredItemList(sourceItems));
    }
    const lengthOfCachedItems = finalItems.length;
    finalItems.unshift(...relevantSourceItems.filter(item => item.guid.value > highestGuid));
    if (finalItems?.length > lengthOfCachedItems) {
        console.log(` 🌟 ${finalItems?.length - lengthOfCachedItems} new thread(s) was added to the ${sourceLabel} feed!`);
    }
    if (finalItems.length) {
        if (feeding.arraysDiffers(finalItems, cached?.cachedItems)) {
            let cached = {};
            try {
                cached = await caching.set(cacheId, {
                    cachedTime: feedRequestTime,
                    cachedItems: finalItems.slice(0, feedLength)
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
    return finalItems;
}

/**
 * Returns a filtered feed of new Canon Rumors Forum threads (topics), omitting the threads created
 * to be a "comment-section" for a news-posting on the main-site.
 * @param feedType {'json'|'rss'}
 * @param reqHeaders {Headers}
 * @param [info] {ServeHandlerInfo<Addr>}
 * @param [logging=false] {boolean} - if true, potentially extra logging for debugging
 * @returns {Promise<{body: string, options: {status: number, statusText: string, headers: Headers}}>}
 */
export async function canonRumorsForum(feedType, reqHeaders, info, logging = false) {

    const CreateFeedTool = feeding.getCreateFeedTool(
        feedType,
        'Canon Rumors Forum - New threads (topics)',
        'Keeping track of new threads (topics) in Canon Rumors Forum, but trying to ignore threads created as comment-section for a news-post on the main-site',
        `${feeding.DeployedAt}/canon/crforumfeed.${feedType}`,
        'https://www.canonrumors.com/forum/',
        'Canon Rumors Forum users',
        'https://www.canonrumors.com/wp-content/uploads/2022/05/logo-alt.png'
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
