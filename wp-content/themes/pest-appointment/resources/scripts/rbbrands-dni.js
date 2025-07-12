const BASE_URL = 'https://api.rbbrands.net/';

const COOKIE_TIME_TO_LIVE = 20; // IN MINUTES

const IMPRESSION_ID_COOKIE_NAME = 'rb_impression_id';

const SKIPPED_TAGS = [
    'SCRIPT',
    'STYLE',
];

function setCookie(name, value, ttl) {
    let expires_at = Date.now() + COOKIE_TIME_TO_LIVE * 60 * 1000;

    if(ttl) {
        expires_at = Date.now() + ttl * 60 * 1000;
    }

    const expires = new Date(expires_at).toGMTString();

    document.cookie = `${name}=${value};expires=${expires};path=/`;
}

function getCookieValue(name) {
    const cookies = document.cookie.split('; ');
    for (const cookie of cookies) {
        const [key, value] = cookie.split('=');
        if (key === name) {
            return decodeURIComponent(value);
        }
    }

    return null;
}

function deleteCookie(name) {
    setCookie(name, '', -1);
}

function standardizePhoneNumber(phone) {
    if(phone.indexOf('+1') !== -1) {
        phone = phone.replace('+1', '');
    }

    return phone.replace(/^(\d{3})(\d{3})(\d{4}).*/, '($1) $2-$3');
}

function replaceTextContent(node, target_number, new_number) {
    let replacement_done = false;

    if (node.nodeType === Node.TEXT_NODE) {
        const original_value = node.textContent;
        const new_value = original_value.replaceAll(target_number, new_number);

        if(original_value !== new_value) {
            node.textContent = new_value;
            replacement_done = true;
        }
    } else {
        for (let child of node.childNodes) {
            const phone_replaced = replaceTextContent(child, target_number, new_number);

            if(phone_replaced) {
                replacement_done = true;
            }
        }
    }

    return replacement_done;
}

function replacePhoneInAttributes(node, target_number, new_number) {
    let replacement_done = false;

    for (const attr of node.attributes) {
        const original_value = attr.value;
        const new_value = original_value.replaceAll(target_number, new_number);

        if(original_value !== new_value) {
            replacement_done = true;
            node.setAttribute(attr.name, new_value);
        }
    }

    return replacement_done;
}

const replacePhoneNumbers = (target_number, new_number) => {
    let replacement_done = false;

    target_number = standardizePhoneNumber(target_number);
    new_number = standardizePhoneNumber(new_number);

    const treeWalker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT
    )

    while (treeWalker.nextNode()) {
        const node = treeWalker.currentNode;

        if(SKIPPED_TAGS.indexOf(node.tagName) !== -1) {
            continue;
        }

        const text_replaced = replaceTextContent(node, target_number, new_number);
        const phone_replaced_in_attribute = replacePhoneInAttributes(node, target_number, new_number);

        if(text_replaced || phone_replaced_in_attribute) {
            replacement_done = true;
        }
    }

    return replacement_done;
};

document.addEventListener("DOMContentLoaded", (event) => {
    const campaign_name = document.getElementById('campaign_name').innerText;
    const areacode = document.getElementById('areacode').innerText;

    const initialize = () => {
        const formData = new FormData;
        formData.append('campaign_name', campaign_name);
        formData.append('areacode', areacode);

        const impression_id = getCookieValue(IMPRESSION_ID_COOKIE_NAME);
        if(impression_id) {
            formData.append('impression_id', impression_id);
        }

        fetch(
            `${BASE_URL}api/number/request`,
            {
                method: 'POST',
                body: formData,
            },
        )
        .then((response) => response.json())
        .then((data) => {
            if(data.status === 'EXPIRED') {
                deleteCookie(IMPRESSION_ID_COOKIE_NAME);
                initialize();
                return;
            }

            if(data.status !== 'VALID') {
                deleteCookie(IMPRESSION_ID_COOKIE_NAME);
                return;
            }

            const replacement_done = replacePhoneNumbers(data.replace_number, data.phone_number);
            if(!replacement_done) {
                return;
            }

            // Always update the cookie'd impression id on a valid response - it may change when a site has multiple verticals
            // if the user does something like clearing the rb_v cookie or adding ?v=2 to a url
            setCookie(IMPRESSION_ID_COOKIE_NAME, data.impression_id);

            heartBeat(true, data.heartbeat_rate, data.url_parameters);
        })
        .catch((error) => {
            //
        })
    };

    const heartBeat = (is_first_call, heartbeat_rate, url_parameters) => {
        setTimeout(() => {
            if(document.hidden) {
                /*
                * Don't call /update endpoint when screen is not active
                * but keep executing the heartbetain case the user returns
                * within the allowed retention period
                */
                heartBeat(false, heartbeat_rate, url_parameters);
                return;
            }

            const impression_id = getCookieValue(IMPRESSION_ID_COOKIE_NAME);
            if(impression_id == null) {
                return;
            }

            let data = {};

            const tags = window._rb_tags || [];
            for (const [key, tagEntries] of Object.entries(tags)) {
                for (const [tag_key, tag_value] of Object.entries(tagEntries)) {
                    data[tag_key] = tag_value;
                }
            }

            const urlParams = new URLSearchParams(window.location.search);

            url_parameters.forEach((url_parameter) => {
                const value = urlParams.get(url_parameter);

                if(value != null) {
                    data[url_parameter] = value;
                }
            });

            fetch(
                `${BASE_URL}api/number/update`,
                {
                    method: 'POST',
                    headers: {
                      'Accept': 'application/json',
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        impression_id,
                        data,
                    })
                },
            )
            .then((response) => response.json())
            .then((data) => {
                if(data.status !== 'VALID') {
                    deleteCookie(IMPRESSION_ID_COOKIE_NAME);
                    return;
                }

                heartBeat(false, heartbeat_rate, url_parameters);
            })
            .catch((error) => {
                //
            })
        }, is_first_call ? 0 : heartbeat_rate);
    };

    initialize();
});
