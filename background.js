// --- START OF FILE background.js ---

// --- START: Additions at the top ---
const PERIODIC_CHECK_ALARM_NAME = "periodicQueueCheck";
const PERIODIC_CHECK_MINUTES = 3; // Check every 3 minutes (adjust if needed)
const RETRY_ALARM_PREFIX = "retry_inject_"; // Prefix for retry alarms
const RETRY_DELAY_MINUTES = 1; // Retry after 1 minute (60 seconds)
// --- END: Additions at the top ---

console.log("Background Service Worker Started (v2.0 - Robust Overdue Handling)."); // Updated log

let isModalShowing = false; // Flag to prevent multiple modals AT THE SAME TIME
let modalTabId = null;      // Which tab is the modal currently shown on?
let pendingReminders = []; // Queue for reminder keys (profileKey) that need to be shown

// --- On Startup: Check for Overdue Follow-ups ---
chrome.runtime.onStartup.addListener(async () => {
    console.log("Browser startup: Checking for overdue follow-ups.");
    await checkAndTriggerOverdueReminders();
    // Ensure periodic check is scheduled on startup
    schedulePeriodicCheck();
});

// --- On Install/Update: Also check and schedule ---
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`Extension ${details.reason}.`);
    schedulePeriodicCheck();
    // Perform initial check slightly delayed to ensure storage is ready
    // Using an alarm is a reliable way to delay in service workers
    console.log("Scheduling initial check for overdue reminders after install/update.");
    // We can reuse the startupCheck name or a dedicated one
    await chrome.alarms.clear("initialCheck"); // Clear previous just in case
    chrome.alarms.create("initialCheck", { delayInMinutes: 0.05 }); // ~3 second delay
});


// --- Alarm Listener ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
    console.log("Alarm received:", alarm.name);

    // --- Handle Periodic Check Alarm ---
    if (alarm.name === PERIODIC_CHECK_ALARM_NAME) {
        console.log("Periodic check alarm fired. Checking reminder queue and overdue items.");
        await checkAndTriggerOverdueReminders(); // Check for newly overdue items as well
        await processNextReminder(); // Attempt to process queue
        console.log(`Periodic check processed. Next check in ${PERIODIC_CHECK_MINUTES} minutes.`);
        // Note: The periodic alarm automatically reschedules itself.
    }
    // --- Handle Retry Alarm ---
    else if (alarm.name.startsWith(RETRY_ALARM_PREFIX)) {
        const profileKey = alarm.name.substring(RETRY_ALARM_PREFIX.length);
        console.log(`Retry alarm fired for: ${profileKey}`);
        // Check if this reminder is still pending and no other modal is showing
        if (!isModalShowing && pendingReminders.length > 0 && pendingReminders[0] === profileKey) {
            console.log(`Attempting retry processing for ${profileKey}`);
            await processNextReminder(); // Re-run the process for this specific reminder
        } else {
            if (isModalShowing) {
                console.log(`Retry alarm for ${profileKey} skipped: Another modal is already showing.`);
            } else if (!pendingReminders.includes(profileKey)) {
                 console.log(`Retry alarm for ${profileKey} skipped: Reminder no longer in queue (likely handled/cleared).`);
            } else if (pendingReminders[0] !== profileKey) {
                 console.log(`Retry alarm for ${profileKey} skipped: No longer at the front of the queue.`);
            }
        }
    }
    // --- Handle Install/Update Check ---
    else if (alarm.name === "initialCheck") {
        console.log("Running delayed initial check after install/update.");
        await checkAndTriggerOverdueReminders();
    }
    // --- Handle Original Follow-up Alarm ---
    else { // Assumed to be a specific follow-up key
        console.log("Follow-up Alarm Fired Normally:", alarm.name);
        enqueueReminder(alarm.name); // Add to queue
        await processNextReminder(); // Attempt to show immediately
    }
});


// --- Tab Activation Listener ---
// Attempt to show pending reminders when user activates a suitable tab
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    console.log("Tab activated:", activeInfo.tabId);
    // If no modal is currently trying to show AND reminders are pending
    if (!isModalShowing && pendingReminders.length > 0) {
        console.log("Active tab changed, pending reminders exist. Attempting to process next.");
        await processNextReminder();
    }
});

// --- Tab Removal Listener ---
// If the tab showing the modal is closed, reset the lock and process next
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    if (tabId === modalTabId) {
        console.warn(`Tab ${tabId} containing the active modal was closed.`);
        isModalShowing = false;
        modalTabId = null;
        // The reminder wasn't acknowledged, it should still be in the queue.
        console.log("Modal tab closed. Processing next reminder if any.");
        await processNextReminder(); // Try showing the same/next reminder
    }
});

// --- Add a key to the reminder queue (if not already present) ---
function enqueueReminder(profileKey) {
    if (!pendingReminders.includes(profileKey)) {
        pendingReminders.push(profileKey);
        console.log(`Enqueued reminder for: ${profileKey}. Queue:`, pendingReminders);
    } else {
        console.log(`Reminder for ${profileKey} already in queue.`);
    }
}

// --- Schedule the Periodic Check Alarm ---
async function schedulePeriodicCheck() {
    try {
        const existingAlarm = await chrome.alarms.get(PERIODIC_CHECK_ALARM_NAME);
        if (!existingAlarm || existingAlarm.periodInMinutes !== PERIODIC_CHECK_MINUTES) {
             chrome.alarms.create(PERIODIC_CHECK_ALARM_NAME, {
                 delayInMinutes: PERIODIC_CHECK_MINUTES, // Wait before first check
                 periodInMinutes: PERIODIC_CHECK_MINUTES // Repeat periodically
             });
            console.log(`Scheduled/Updated periodic queue check alarm (${PERIODIC_CHECK_ALARM_NAME}) to run every ${PERIODIC_CHECK_MINUTES} minutes.`);
        } else {
             console.log(`Periodic check alarm (${PERIODIC_CHECK_ALARM_NAME}) already scheduled correctly.`);
        }
    } catch (error) {
        console.error("Error scheduling periodic check alarm:", error);
    }
}

// --- Check Overdue Reminders Stored in Local Storage ---
async function checkAndTriggerOverdueReminders() {
    console.log("Executing checkAndTriggerOverdueReminders");
    try {
        const result = await chrome.storage.local.get(['dm_followups']);
        const followups = result.dm_followups || {};
        const now = Date.now();
        let foundOverdueCount = 0;

        for (const key in followups) {
            const data = followups[key];
            // Check if remindAt exists and is in the past
            if (data.remindAt && data.remindAt <= now) {
                // Check if it's already in the queue to avoid duplicates from rapid checks
                if (!pendingReminders.includes(key)) {
                    console.log(`Found overdue follow-up: ${key} (Remind time: ${new Date(data.remindAt).toLocaleString()})`);
                    enqueueReminder(key); // Add to our processing queue
                    foundOverdueCount++;
                }
            }
        }

        if (foundOverdueCount > 0) {
            console.log(`Enqueued ${foundOverdueCount} overdue follow-ups.`);
            // Sort the queue by remindAt time (oldest first) after adding all
            pendingReminders.sort((keyA, keyB) => {
                const timeA = followups[keyA]?.remindAt || 0;
                const timeB = followups[keyB]?.remindAt || 0;
                return timeA - timeB;
            });
            console.log("Sorted pending queue:", pendingReminders);
            // Attempt to show the first one immediately if no modal is active
            // processNextReminder will be called after this function finishes usually
        } else {
             console.log("No new overdue follow-ups found in storage.");
        }

    } catch (error) {
        console.error("Error checking overdue follow-ups:", error);
    }
}

// --- Process the next reminder in the queue ---
async function processNextReminder() {
    if (isModalShowing) {
        console.log("Modal lock is active. Postponing processing.");
        return; // Don't show another modal yet
    }
    if (pendingReminders.length === 0) {
        console.log("Reminder queue is empty.");
        return; // Nothing to process
    }

    // Get the next key WITHOUT removing it yet
    const keyToShow = pendingReminders[0];
    console.log("Attempting to process reminder for key:", keyToShow);
    isModalShowing = true; // Set lock: Attempting to show a modal

    try {
        const result = await chrome.storage.local.get(['dm_followups', 'dm_tags']);
        const followups = result.dm_followups || {};
        const tags = result.dm_tags || {};

        const followupData = followups[keyToShow];
        const tagData = tags[keyToShow];

        if (followupData?.profileData) {
             // Combine followup data with tag and notes
            const fullData = {
                ...followupData, // Includes profileKey, profileData, remindAt, scheduledAt, notes
                tag: tagData?.tag || null // Add the tag info
            };
            console.log("Found data, attempting to show modal:", fullData);
            const success = await showModalOnActiveTab(fullData);

            if (!success) {
                 // If showing modal failed (e.g., no suitable tab), unlock but leave item in queue
                 console.log(`Failed to show modal for ${keyToShow}. Resetting lock, keeping in queue.`);
                 isModalShowing = false;
                 modalTabId = null;

                 // --- Schedule a retry attempt ---
                 const retryAlarmName = RETRY_ALARM_PREFIX + keyToShow;
                 try {
                     // Clear any existing retry alarm for this key first
                     await chrome.alarms.clear(retryAlarmName);
                     console.log(`Scheduling retry attempt (${retryAlarmName}) for ${keyToShow} in ${RETRY_DELAY_MINUTES} minute(s).`);
                     chrome.alarms.create(retryAlarmName, { delayInMinutes: RETRY_DELAY_MINUTES });
                 } catch (retryError) {
                     console.error(`Error scheduling retry alarm for ${keyToShow}:`, retryError);
                 }
                 // Reminder stays in the queue. Other triggers might succeed before the retry alarm.
            }
            // If successful, isModalShowing remains true until acknowledgement or tab closure
        } else {
            console.warn("Data not found or incomplete for key:", keyToShow, ". Clearing associated data and removing from queue.");
            await clearFollowUpData(keyToShow, true); // Clear bad data AND remove from queue
            isModalShowing = false; // Unlock
            modalTabId = null;
            await processNextReminder(); // Immediately try the next one
        }
    } catch (error) {
        console.error(`Error during processing reminder for ${keyToShow}:`, error);
        isModalShowing = false; // Unlock on error
        modalTabId = null;
        // Don't remove from queue on generic storage error, let next check retry
        // Schedule a retry in case of generic error too? Maybe.
        const retryAlarmName = RETRY_ALARM_PREFIX + keyToShow;
        try {
             await chrome.alarms.clear(retryAlarmName);
             console.warn(`Scheduling retry for ${keyToShow} due to processing error.`);
             chrome.alarms.create(retryAlarmName, { delayInMinutes: RETRY_DELAY_MINUTES });
        } catch (retryError) { console.error(`Error scheduling retry alarm after processing error for ${keyToShow}:`, retryError); }
    }
}

// --- Inject and Show Modal on Active Tab ---
// Returns true if injection attempt was made successfully (even if CSS/script fails later), false otherwise
async function showModalOnActiveTab(followupData) {
    const profileKey = followupData.profileKey;
    let activeTab = null;
    try {
        // Find the currently active tab in the current window
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0 || !tabs[0]?.id) {
            console.warn("No active tab found. Reminder postponed for:", profileKey);
            return false; // Indicate failure: No target
        }
        activeTab = tabs[0];

        // Prevent injection into restricted pages (chrome://, about:, extension store)
        // Allow injection into skool.com regardless of other checks
        const isSkoolPage = activeTab.url?.startsWith("https://www.skool.com/");
        if (!isSkoolPage && (activeTab.url?.startsWith("chrome://") || activeTab.url?.startsWith("about:") || activeTab.url?.includes("://chrome.google.com/"))) {
             console.warn(`Cannot inject script into restricted page: ${activeTab.url}. Reminder postponed for:`, profileKey);
             return false; // Indicate failure: Restricted target
        }

        console.log(`Attempting to inject modal into tab ${activeTab.id} (${activeTab.url || 'N/A'}) for ${profileKey}`);

        // Check if the modal *already exists* in this specific tab before trying to inject
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: () => !!document.getElementById('skool-followup-modal-overlay') // Check function
            });

            if (results && results[0]?.result === true) {
                console.warn(`Modal overlay already exists in target tab ${activeTab.id}. Aborting injection for ${profileKey}.`);
                // Don't reset isModalShowing here, as *a* modal is showing, just not the one we tried to inject.
                // Let the existing modal resolve itself. We keep our reminder queued.
                isModalShowing = false; // Let's actually reset the lock here, the check prevented injection
                modalTabId = null;      // And clear the tab ID
                return false; // Indicate failure: Already present
            }
        } catch (execError) {
            // This can happen if the tab is loading or doesn't have content script permissions yet
            console.warn(`Error checking for existing modal in tab ${activeTab.id}: ${execError.message}. Proceeding with injection attempt cautiously.`);
             // Don't return false here, maybe injection will work now.
        }


        // 1. Inject CSS (make sure modal.css is in web_accessible_resources)
        await chrome.scripting.insertCSS({
            target: { tabId: activeTab.id },
            files: ["modal.css"]
        });

        // 2. Execute Script to create and show modal
        await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: showFollowUpModal_Injected,
            args: [followupData] // Pass the full data
        });

        console.log("Modal script executed successfully for", profileKey, "on tab", activeTab.id);
        modalTabId = activeTab.id; // Track the tab ID where the modal *should* now be
        // isModalShowing remains true
        return true; // Indicate injection attempt success

    } catch (error) {
         // Catch potential errors during injection (e.g., no permissions, tab closed during query)
        console.error(`Error injecting modal script/CSS for ${profileKey} into tab ${activeTab?.id || 'unknown'}:`, error);
        // An error here means injection failed, so reset the lock state
        isModalShowing = false;
        modalTabId = null;
        return false; // Indicate failure
    }
}


// --- This function is INJECTED into the active tab ---
// (Keep the existing showFollowUpModal_Injected function as is - it includes notes display)
function showFollowUpModal_Injected(followupData) {
    // Ensure this function doesn't run twice if injection happens rapidly
    if (document.getElementById('skool-followup-modal-overlay')) {
        console.warn("Injected: Follow-up modal already exists. Skipping.");
        return;
    }

    const profile = followupData.profileData;
    const profileKey = followupData.profileKey;
    const tag = followupData.tag;
    const notes = followupData.notes; // Get notes from data

    const overlay = document.createElement('div');
    overlay.id = 'skool-followup-modal-overlay';
    overlay.className = 'skool-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'skool-modal-content';

    const title = document.createElement('h3');
    title.textContent = 'Skool Follow-up Reminder';
    title.className = 'skool-modal-title';

    const img = document.createElement('img');
    // Use chrome.runtime.getURL for the fallback icon path
    // Note: Inside injected script, chrome.runtime.getURL might not be directly available
    // if the context is isolated. It's safer to pass the URL from the background if needed,
    // but typically browsers allow access to web_accessible_resources.
    // Let's assume direct access works for now, or fallback to a placeholder if it fails.
    const fallbackIcon = "icon.png"; // Relative path, browser resolves based on manifest
    img.src = profile.profilePicDataUrl || profile.profilePic || fallbackIcon; // Try dataUrl, then URL, then fallback
    img.alt = profile.username || 'User Profile';
    img.style.cssText = 'width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 15px auto; display: block; border: 2px solid #eaeaea; object-fit: cover; background-color: #f0f0f0;';
     // Add error handling for image loading
     img.onerror = () => {
         console.warn("Modal Image Error: Could not load profile picture. Using fallback.");
         // Try getURL if possible, otherwise just the relative path
         try {
             img.src = chrome.runtime.getURL ? chrome.runtime.getURL(fallbackIcon) : fallbackIcon;
         } catch (e) {
             img.src = fallbackIcon; // Final fallback
         }
         img.onerror = null; // Prevent infinite loops
     };


    const messageP = document.createElement('p');
    messageP.className = 'skool-modal-message';
    messageP.innerHTML = `Time to follow up with <strong></strong>!`;
    const strongName = messageP.querySelector('strong');
    if (strongName) strongName.textContent = profile.username || 'this user';

    const tagP = document.createElement('p');
    tagP.className = 'skool-modal-tag'; // Use a specific class
    tagP.innerHTML = `Tag: <span style="font-weight: bold; color: ${tag ? '#2928ff' : '#6b7280'};">${tag || 'None'}</span>`; // Match modal.css colors


    // --- Notes Display ---
    let notesP = null;
    if (notes) {
        notesP = document.createElement('div'); // Use div for better block handling
        notesP.className = 'skool-modal-notes';
        const notesTitle = document.createElement('strong');
        notesTitle.textContent = 'Notes:';
        notesP.appendChild(notesTitle);
        const notesContent = document.createElement('p'); // Actual notes text in a p
        notesContent.textContent = notes;
        notesP.appendChild(notesContent);
    }

    const link = document.createElement('a');
    link.href = profile.profileLink || '#';
    link.textContent = `Open ${profile.username || 'User'}'s Profile/DM`;
    link.target = '_blank';
    link.className = 'skool-modal-link';
     if (!profile.profileLink) {
         link.onclick = (e) => e.preventDefault();
         link.style.opacity = '0.6';
         link.style.cursor = 'default';
         link.title = 'Profile link not available';
     }

    const okButton = document.createElement('button');
    okButton.textContent = 'OK & Clear Reminder';
    okButton.className = 'skool-modal-button';
    okButton.onclick = () => {
        try {
            if (overlay && overlay.parentNode) {
                overlay.remove();
            } else {
                 console.warn("Could not find overlay to remove.");
            }
            // Send message back to background script to clear data, alarm, and QUEUE ITEM
            chrome.runtime.sendMessage({ action: "followUpAcknowledged", profileKey: profileKey }, (response) => {
                 if (chrome.runtime.lastError) { console.error("Injected Script: Error sending acknowledgement:", chrome.runtime.lastError.message);
                 } else { console.log("Injected Script: Follow-up acknowledged message sent.", response); }
            });
        } catch (e) {
            console.error("Error during modal button click handler:", e);
        }
    };

    modal.appendChild(title);
    modal.appendChild(img);
    modal.appendChild(messageP);
    modal.appendChild(tagP);
    if (notesP) { modal.appendChild(notesP); }
    if (profile.profileLink) { modal.appendChild(link); }
    modal.appendChild(okButton);
    overlay.appendChild(modal);

    // Append to body
     if (document.body) {
        document.body.appendChild(overlay);
     } else {
        console.error("Document body not found when trying to append modal.");
        // Fallback: append to documentElement, though less ideal
        document.documentElement.appendChild(overlay);
     }
}
// --- END OF INJECTED FUNCTION ---

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message.action, message); // Log action clearly

  if (message.action === "scheduleAlarm") {
    // (No changes needed here)
    if (!message.name || !message.when || message.when <= Date.now()) {
        console.error("Invalid alarm data received:", message);
        sendResponse({ success: false, error: "Invalid alarm data (name or past time)" });
        return false;
    }
    (async () => {
        try {
            // Clear existing alarm first before creating a new one for the same name
            await chrome.alarms.clear(message.name);
            await chrome.alarms.create(message.name, { when: message.when });
            console.log("Alarm created/updated successfully:", message.name, new Date(message.when));
            // Clear any pending retry alarm for this key as it's been rescheduled
            await chrome.alarms.clear(RETRY_ALARM_PREFIX + message.name);
            sendResponse({ success: true });
        } catch (error) {
            console.error("Error creating alarm:", error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true; // Indicate async response

  } else if (message.action === "clearAlarm") {
    // (This is usually called from the popup or content script 'clear' button)
     if (!message.name) {
        console.error("Invalid clearAlarm message (missing name):", message);
        sendResponse({ success: false, error: "Missing alarm name" });
        return false;
    }
    // Clear the data/alarm AND remove from queue if present
    // Pass false for removeFromQueue because this is an explicit clear, not an acknowledgement
    clearFollowUpData(message.name, true) // Actually, let's remove from queue here too for consistency
        .then(wasFound => sendResponse({ success: true, wasCleared: wasFound }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Indicate async response

  } else if (message.action === "followUpAcknowledged") {
    // --- Handle acknowledgement from the MODAL---
    const profileKey = message.profileKey;
    if (!profileKey) {
        console.error("Received followUpAcknowledged message without profileKey");
        sendResponse({ success: false, error: "Missing profileKey" });
        return false;
    }
    console.log(`Follow-up acknowledged by user for: ${profileKey}. Clearing data.`);
    // Clear data/alarm and REMOVE the acknowledged item from the queue front
    clearFollowUpData(profileKey, true) // Pass true to ensure removal from queue
      .then(() => {
          sendResponse({ success: true });
          // Reset lock ONLY if the acknowledged modal was the one we were tracking
          if (sender.tab?.id === modalTabId || !sender.tab) { // Allow if message not from tab (rare)
               isModalShowing = false;
               modalTabId = null;
               console.log("Modal flag reset. Processing next reminder if any.");
               // Use a slight delay before processing next, allowing UI to settle
               setTimeout(() => { processNextReminder(); }, 150); // 150ms delay
          } else {
              console.warn(`Acknowledgement received from tab ${sender.tab?.id}, but modal was tracked on tab ${modalTabId}. Not resetting modal lock.`);
              // Don't process next reminder automatically in this case, wait for the tracked modal to resolve or tab to close.
          }
      })
      .catch(err => {
          console.error(`Error clearing data after acknowledgement for ${profileKey}:`, err);
          sendResponse({ success: false, error: err.message });
          // Still reset the flag and try next, even if clearing had an issue,
          // but only if the sender tab matches the tracked tab.
          if (sender.tab?.id === modalTabId || !sender.tab) {
             isModalShowing = false;
             modalTabId = null;
             setTimeout(() => { processNextReminder(); }, 150);
          }
      });
    return true; // Indicate asynchronous response
  }
  // Return false if the message wasn't handled and no async response is needed
  // sendResponse({}); // Optional empty response for unhandled cases
  return false;
});


// --- Helper to clear FollowUp Data, Alarm, Queue item, and Retry Alarm ---
async function clearFollowUpData(profileKey, removeFromQueue = false) {
  console.log(`Attempting to clear follow-up data/alarm for: ${profileKey}. Remove from queue: ${removeFromQueue}`);
  let wasDataFound = false;
  try {
    // Clear from storage
    const result = await chrome.storage.local.get('dm_followups');
    const followups = result.dm_followups || {};
    if (followups[profileKey]) {
      delete followups[profileKey];
      await chrome.storage.local.set({ dm_followups: followups });
      console.log(`Cleared follow-up data from storage for ${profileKey}`);
      wasDataFound = true;
    } else {
       console.log(`No follow-up data found in storage to clear for ${profileKey}`);
    }

    // Clear the main alarm (best effort)
    try {
        await chrome.alarms.clear(profileKey);
        console.log(`Main alarm clear attempt successful for ${profileKey}`);
    } catch (alarmError) {
        // Ignore "No alarm found" error
        if (!alarmError.message.includes("No alarm found")) {
            console.warn(`Error clearing main alarm for ${profileKey}:`, alarmError.message);
        } else {
            console.log(`No main alarm found with name ${profileKey} to clear.`);
        }
    }

    // Clear the retry alarm (best effort)
    const retryAlarmName = RETRY_ALARM_PREFIX + profileKey;
    try {
        const wasRetryCleared = await chrome.alarms.clear(retryAlarmName);
        if (wasRetryCleared) {
            console.log(`Retry alarm clear attempt successful for ${retryAlarmName}`);
        } else {
            // This is expected if no retry was scheduled or it already fired
            // console.log(`No retry alarm found with name ${retryAlarmName} to clear.`);
        }
    } catch (retryAlarmError) {
         console.warn(`Error clearing retry alarm for ${retryAlarmName}:`, retryAlarmError.message);
    }


    // Remove from pending queue if needed
    const index = pendingReminders.indexOf(profileKey);
    if (index > -1) {
        // Remove if explicitly requested (acknowledgement or explicit clear)
        // OR if the data wasn't found (stale/bad queue entry)
        if (removeFromQueue || !wasDataFound) {
             pendingReminders.splice(index, 1);
             console.log(`Removed ${profileKey} from pending queue. New queue:`, pendingReminders);
        } else {
            // This case should be less common now with removeFromQueue = true on clear/ack
            console.log(`Keeping ${profileKey} in queue (removeFromQueue=${removeFromQueue}, wasDataFound=${wasDataFound}).`);
        }
    }
    return wasDataFound; // Indicate if data was actually deleted from storage
  } catch (error) {
    console.error(`Error in clearFollowUpData for ${profileKey}:`, error);
    throw error; // Re-throw for caller
  }
}

// --- END OF FILE background.js ---