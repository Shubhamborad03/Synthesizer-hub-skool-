// --- START OF FILE popup.js ---
document.addEventListener('DOMContentLoaded', () => {
  console.log("Popup DOM loaded.");

  // --- Global Elements ---
  const quoteTextEl = document.getElementById('quote-text');
  const videoPlayerWrapperEl = document.getElementById('video-player-wrapper');
  const videoLoadingEl = document.getElementById('video-loading');
  const todoForm = document.getElementById('todo-form');
  const todoInput = document.getElementById('todo-input');
  const todoListEl = document.getElementById('todo-list');
  const taggedListEl = document.getElementById('tagged-list');
  const followupsListEl = document.getElementById('followups-list');
  const manageBtn = document.getElementById('manage-tags-btn');
  const tagManager = document.getElementById('tag-manager');

  // --- Global Data ---
  let allQuotes = [];
  let allYoutubeLinks = [];
  let todoTasks = []; // Combined list (default + user)
  let currentDmTags = {};
  let currentTagOptions = [];
  const defaultTags = ["Lead", "Follow Up", "Not Interested", "Hot Prospect", "Sales"];
  let jsConfetti = null; // For confetti effect

  // *** ADDED: Define Default To-Do Tasks ***
  const defaultTodoTasks = [
    { id: 'default-1', text: "Create 1 post in Synthesizer Community", completed: false, isDefault: true },
    { id: 'default-2', text: "Help fellow Synthesizer through a comment", completed: false, isDefault: true },
    { id: 'default-3', text: "Take one small steps for a Big Goal", completed: false, isDefault: true }
  ];

  // --- Initialization ---
  initializeDashboard();

  // --- Main Initialization Function ---
  async function initializeDashboard() {
      console.log("Initializing Dashboard...");
      try {
          // *** UPDATED: Initialize Confetti ***
          if (typeof JSConfetti !== 'undefined') {
              jsConfetti = new JSConfetti();
              console.log("Confetti initialized.");
          } else {
              console.warn("JSConfetti library not found. Make sure js-confetti.browser.js is included.");
          }
          // *** ADDED: Check for Day.js ***
          if (typeof dayjs === 'undefined') {
             console.error("Day.js library not found. Make sure it's included in popup.html.");
          }

          // Fetch external data
          [allQuotes, allYoutubeLinks] = await Promise.all([
              fetchJsonData('quotes.json', []),
              fetchJsonData('youtube_links.json', [])
          ]);
          console.log(`Loaded ${allQuotes.length} quotes, ${allYoutubeLinks.length} links.`);

          // Load data from Chrome storage
          const storageData = await getStorageDataPromise([
              'daily_tracker', 'todo_tasks', 'dm_followups', 'dm_tags', 'tag_options'
          ]);
          console.log("Storage data loaded:", storageData);

          // *** UPDATED: Process To-Do with Default Tasks ***
          const userTasks = (storageData.todo_tasks || []).filter(task => !task.isDefault); // Filter out old defaults just in case
          todoTasks = [...defaultTodoTasks, ...userTasks]; // Prepend defaults to user tasks

          // Ensure defaults have correct initial 'completed' status from storage if already interacted with today
          const loadedDefaultStatuses = (storageData.todo_tasks || []).filter(task => task.isDefault);
          todoTasks.forEach(task => {
              if (task.isDefault) {
                   const loadedStatus = loadedDefaultStatuses.find(ld => ld.id === task.id);
                   if (loadedStatus) {
                       task.completed = loadedStatus.completed;
                   }
              }
          });
          // Immediately save potentially merged list (ensures defaults are saved on first run)
          await saveTasks();

          // Process Daily Features (includes resetting default task completion)
          await processDailyFeatures(storageData.daily_tracker || {}); // Make sure this awaits

          renderTodoList(); // Render after potentially resetting defaults

          // Process Skool Data
          currentDmTags = storageData.dm_tags || {};
          currentTagOptions = storageData.tag_options || [...defaultTags];
          const dmFollowups = storageData.dm_followups || {};

          loadFollowupsSection(dmFollowups, currentDmTags);
          loadTagsSection(currentDmTags, currentTagOptions);
          setupTagManager();

          console.log("Dashboard Initialized Successfully.");

      } catch (error) {
          console.error("Failed to initialize dashboard:", error);
          // Display errors
          if (quoteTextEl) quoteTextEl.textContent = "Error loading quote.";
          if (videoLoadingEl) videoLoadingEl.textContent = "Error loading video.";
          if (todoListEl) todoListEl.innerHTML = '<p class="no-items">Error loading tasks.</p>';
          if (followupsListEl) followupsListEl.innerHTML = '<p class="no-tags">Error loading follow-ups.</p>';
          if (taggedListEl) taggedListEl.innerHTML = '<p class="no-tags">Error loading tags.</p>';
          if (tagManager) tagManager.innerHTML = '<p class="no-items">Error loading manager.</p>';
      }
  }

  // --- Utility Functions ---
  function getStorageDataPromise(keys) {
      return new Promise((resolve, reject) => {
          chrome.storage.local.get(keys, (result) => {
              if (chrome.runtime.lastError) {
                  return reject(chrome.runtime.lastError);
              }
              resolve(result);
          });
      });
  }

   function setStorageDataPromise(data) {
      return new Promise((resolve, reject) => {
          chrome.storage.local.set(data, () => {
              if (chrome.runtime.lastError) {
                 return reject(chrome.runtime.lastError);
              }
              resolve();
          });
      });
  }

  async function fetchJsonData(url, defaultValue) {
      try {
          const response = await fetch(chrome.runtime.getURL(url));
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${url}`);
          return await response.json();
      } catch (error) {
          console.error(`Failed to fetch ${url}:`, error);
          return defaultValue;
      }
  }

  // --- Daily Quote and Video Logic ---
  // *** UPDATED to use Day.js and Reset Default Tasks ***
  async function processDailyFeatures(tracker) {
      if (typeof dayjs === 'undefined') {
          console.error("Day.js not available in processDailyFeatures.");
          // Fallback to potentially less reliable Date.toDateString() or skip update
          // Using Date.toDateString() as a basic fallback
           const today = new Date().toDateString();
           if (tracker.lastDisplayedDate !== today) {
               console.warn("Day.js missing, falling back to Date.toDateString() for daily check.");
               await updateQuoteVideo(tracker, true, today);
               await resetDefaultTasksIfNeeded(true); // Reset defaults if date changed
           } else {
               await updateQuoteVideo(tracker, false);
               await resetDefaultTasksIfNeeded(false);
           }
           return;
      }

      const todayFormatted = dayjs().format('YYYY-MM-DD'); // Use Day.js format
      let needsUpdate = false;

      if (tracker.lastDisplayedDate !== todayFormatted) {
          console.log(`New day detected (${todayFormatted}). Updating quote, video, and resetting default tasks.`);
          needsUpdate = true;
          await resetDefaultTasksIfNeeded(true); // Reset default tasks
      } else {
          console.log("Same day, using stored indices.");
          await resetDefaultTasksIfNeeded(false); // Ensure defaults are loaded correctly but not reset
      }

      // Update quote and video based on whether it's a new day
      await updateQuoteVideo(tracker, needsUpdate, todayFormatted);
  }

  async function updateQuoteVideo(tracker, isNewDay, todayFormatted) {
       let quoteIndex = tracker.lastQuoteIndex ?? -1;
       let videoIndexInShuffledList = tracker.lastVideoIndex ?? -1;
       let shuffledVideoIndices = tracker.shuffledVideoIndices || [];
       let needsStorageUpdate = isNewDay; // Needs update if it's a new day

       if (isNewDay) {
           // --- Quote Rotation ---
           if (allQuotes.length > 0) quoteIndex = (quoteIndex + 1) % allQuotes.length;
           else quoteIndex = -1;

           // --- Video Rotation ---
           if (allYoutubeLinks.length > 0) {
               if (!shuffledVideoIndices || videoIndexInShuffledList >= shuffledVideoIndices.length - 1 || shuffledVideoIndices.length !== allYoutubeLinks.length) {
                   console.log("Reshuffling video list.");
                   shuffledVideoIndices = Array.from({ length: allYoutubeLinks.length }, (_, i) => i).sort(() => Math.random() - 0.5);
                   videoIndexInShuffledList = 0;
               } else { videoIndexInShuffledList++; }
           } else { videoIndexInShuffledList = -1; shuffledVideoIndices = []; }

           // --- Prepare Tracker Update ---
           tracker.lastDisplayedDate = todayFormatted;
           tracker.lastQuoteIndex = quoteIndex;
           tracker.lastVideoIndex = videoIndexInShuffledList;
           tracker.shuffledVideoIndices = shuffledVideoIndices;

       } else { // Same day, validate indices
            if (allQuotes.length > 0) quoteIndex = Math.min(quoteIndex, allQuotes.length - 1); else quoteIndex = -1;
            if (allYoutubeLinks.length > 0 && shuffledVideoIndices.length === allYoutubeLinks.length) {
                videoIndexInShuffledList = Math.min(videoIndexInShuffledList, shuffledVideoIndices.length - 1);
            } else { // Data mismatch, force reshuffle on next load
                console.warn("Video list size mismatch or invalid index, clearing shuffle for next time.");
                tracker.shuffledVideoIndices = []; tracker.lastVideoIndex = -1;
                shuffledVideoIndices = []; videoIndexInShuffledList = -1;
                needsStorageUpdate = true; // Need to save the cleared shuffle state
            }
       }

       // --- Display ---
       if (quoteTextEl) quoteTextEl.textContent = (quoteIndex !== -1 && allQuotes[quoteIndex]) ? allQuotes[quoteIndex] : "No quote available today.";
       if (videoLoadingEl && videoPlayerWrapperEl) {
           if (videoIndexInShuffledList !== -1 && shuffledVideoIndices.length > videoIndexInShuffledList) {
               const actualVideoIndex = shuffledVideoIndices[videoIndexInShuffledList];
               if (actualVideoIndex >= 0 && actualVideoIndex < allYoutubeLinks.length && allYoutubeLinks[actualVideoIndex]) {
                   displayYouTubeVideo(allYoutubeLinks[actualVideoIndex]);
               } else { displayVideoError("Error loading video link."); }
           } else { displayVideoError("No video available today."); }
       }

       // --- Save Tracker if Needed ---
       if (needsStorageUpdate) {
           try {
               await setStorageDataPromise({ daily_tracker: tracker });
               console.log("Daily tracker updated:", tracker);
           } catch (error) { console.error("Error saving daily tracker:", error); }
       }
  }

  function displayVideoError(message) {
      if (videoLoadingEl && videoPlayerWrapperEl) {
          videoLoadingEl.textContent = message;
          videoPlayerWrapperEl.innerHTML = ''; // Clear wrapper
          videoPlayerWrapperEl.appendChild(videoLoadingEl);
      }
  }

  // *** ADDED: Helper to reset default task completion status ***
  async function resetDefaultTasksIfNeeded(isNewDay) {
      let changed = false;
      todoTasks.forEach(task => {
          if (task.isDefault) {
              if (isNewDay && task.completed) { // Only reset if it was completed
                  task.completed = false;
                  changed = true;
              }
               // Ensure default tasks always have the 'isDefault' flag and a unique ID
               task.isDefault = true;
               if (!task.id || !task.id.startsWith('default-')) {
                  const matchingDefault = defaultTodoTasks.find(dt => dt.text === task.text);
                  task.id = matchingDefault ? matchingDefault.id : `default-unknown-${Math.random().toString(36).substring(7)}`;
                  changed = true; // Mark changed if ID needed fixing
               }
          }
      });

      if (changed) {
          console.log("Resetting completion status for default tasks.");
          await saveTasks(); // Save the updated list with reset statuses
          // No need to re-render here, renderTodoList happens after processDailyFeatures finishes
      }
  }


  // --- Display YouTube Video & ID Extraction (Keep As Is) ---
   function displayYouTubeVideo(url) {
      if (!videoPlayerWrapperEl || !videoLoadingEl) return;
      const videoId = extractYouTubeVideoId(url);
      if (videoId) {
          const iframe = document.createElement('iframe');
          iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}`;
          iframe.title = "YouTube video player";
          iframe.frameBorder = "0";
          iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
          iframe.allowFullscreen = true;
          videoPlayerWrapperEl.innerHTML = '';
          videoPlayerWrapperEl.appendChild(iframe);
      } else {
           displayVideoError("Invalid YouTube URL.");
           console.warn("Could not extract video ID from:", url);
      }
  }

  function extractYouTubeVideoId(url) {
      if (!url) return null; let videoId = null;
      try {
          const urlObj = new URL(url);
          if (urlObj.hostname === "youtu.be") { videoId = urlObj.pathname.split('/')[1]; }
          else if (urlObj.hostname.includes("youtube.com")) { videoId = urlObj.searchParams.get("v"); }
          if (videoId) videoId = videoId.split('&')[0].split('?')[0];
      } catch (e) {
           const regexes = [ /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/, /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/, /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/, /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/ ];
           for (const regex of regexes) { const match = url.match(regex); if (match && match[1]) { videoId = match[1]; break; } }
      }
      return (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) ? videoId : null;
  }

  // --- To-Do List Logic ---
  // *** UPDATED: saveTasks saves combined list ***
  async function saveTasks() {
      try {
           // Filter out any tasks that might have invalid structure before saving
           const validTasks = todoTasks.filter(task => typeof task === 'object' && task !== null && typeof task.text === 'string');
           if(validTasks.length !== todoTasks.length) {
                console.warn("Attempted to save invalid task data. Filtering before saving.", todoTasks);
                todoTasks = validTasks; // Update global list to valid tasks
           }
          await setStorageDataPromise({ todo_tasks: todoTasks });
          console.log("To-Do tasks saved.");
      } catch (error) {
           console.error("Error saving To-Do tasks:", error);
           alert("Error saving tasks!");
      }
  }

  // *** UPDATED: renderTodoList checks for default tasks ***
  function renderTodoList() {
      if (!todoListEl) { console.error("Todo list element not found!"); return; }
      todoListEl.innerHTML = ''; // Clear current list

      // Filter out potentially invalid tasks before rendering
       const tasksToRender = todoTasks.filter(task => typeof task === 'object' && task !== null && typeof task.text === 'string');

      if (tasksToRender.length === 0) {
          todoListEl.innerHTML = '<p class="no-items">No tasks yet! Add one above.</p>';
          return;
      }

       // Ensure default tasks are always first and user tasks follow
       const defaultTasksRender = tasksToRender.filter(t => t.isDefault).sort((a, b) => (a.id || '').localeCompare(b.id || '')); // Sort defaults by ID
       const userTasksRender = tasksToRender.filter(t => !t.isDefault);
       const sortedTasksToRender = [...defaultTasksRender, ...userTasksRender];

       // Store the correct index mapping after sorting for defaults
       const originalIndexMap = new Map();
       sortedTasksToRender.forEach((task, renderIndex) => {
           const originalIndex = todoTasks.findIndex(originalTask => originalTask.id === task.id || originalTask.text === task.text); // Use ID preferably
           if(originalIndex !== -1) {
                originalIndexMap.set(renderIndex, originalIndex);
           } else {
                console.warn("Could not map rendered task back to original:", task);
           }
       });

      sortedTasksToRender.forEach((task, renderIndex) => {
          const originalIndex = originalIndexMap.get(renderIndex);
          if (originalIndex === undefined) return; // Skip if mapping failed

          const listItem = document.createElement('li');
          listItem.dataset.index = originalIndex; // Use the index from the original todoTasks array

          const taskContentDiv = document.createElement('div');
          taskContentDiv.className = 'task-content';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = !!task.completed;
          checkbox.title = task.completed ? "Mark as incomplete" : "Mark as complete";
          checkbox.addEventListener('change', handleToggleTaskCompletion);

          const taskNameSpan = document.createElement('span');
          taskNameSpan.textContent = task.text;
          if (task.completed) taskNameSpan.classList.add('completed');

          // Only allow editing non-default tasks
          if (!task.isDefault) {
              taskNameSpan.addEventListener('dblclick', handleEnableTaskEdit);
              taskNameSpan.style.cursor = 'text'; // Indicate editable
          } else {
               taskNameSpan.style.cursor = 'default'; // Indicate non-editable
          }

          taskContentDiv.appendChild(checkbox);
          taskContentDiv.appendChild(taskNameSpan);
          listItem.appendChild(taskContentDiv);

          // Only add actions div (and delete button) for non-default tasks
          if (!task.isDefault) {
              const taskActionsDiv = document.createElement('div');
              taskActionsDiv.className = 'task-actions';

              const deleteButton = document.createElement('button');
              deleteButton.innerHTML = `<i class="fas fa-trash"></i>`;
              deleteButton.classList.add('delete-btn'); // Use specific class for potential Todo styling overrides
              deleteButton.title = "Delete Task";
              deleteButton.addEventListener('click', handleDeleteTask);

              taskActionsDiv.appendChild(deleteButton);
              listItem.appendChild(taskActionsDiv); // Append actions only if not default
          }

          todoListEl.appendChild(listItem);
      });
  }

  // *** UPDATED: handleAddTask ensures new tasks are not marked as default ***
  function handleAddTask(event) {
      event.preventDefault();
      if (!todoInput) return;
      const taskText = todoInput.value.trim();
      if (taskText === '') return;

      // Create a unique ID for user tasks to help with mapping
      const newTaskId = `user-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      todoTasks.push({ id: newTaskId, text: taskText, completed: false, isDefault: false }); // Ensure isDefault is false
      todoInput.value = '';
      renderTodoList();
      saveTasks();
  }

  // *** UPDATED: handleToggleTaskCompletion uses dataset.index ***
  function handleToggleTaskCompletion(event) {
      const checkbox = event.target;
      const listItem = checkbox.closest('li');
      if (!listItem) return;
      const index = parseInt(listItem.dataset.index, 10); // Get index from dataset

      if (isNaN(index) || index < 0 || index >= todoTasks.length) {
          console.error("Invalid index for task completion:", index);
          return;
      }

      todoTasks[index].completed = checkbox.checked;

      // *** UPDATED: Trigger Confetti ***
      if (checkbox.checked && jsConfetti) {
           try {
              jsConfetti.addConfetti({
                 particleCount: 150, // Slightly more confetti
                 spread: 90,         // Wider spread
                 origin: { y: 0.7 }   // Originate slightly lower
               });
               console.log("Confetti triggered!");
           } catch(e) { console.error("Confetti error:", e)}
      }

      // No need to re-render the whole list, just update style and save
      const taskNameSpan = listItem.querySelector('.task-content span');
      if (taskNameSpan) {
          taskNameSpan.classList.toggle('completed', checkbox.checked);
      }
      saveTasks();
  }

  // *** UPDATED: handleDeleteTask checks for default and NO confirmation ***
  function handleDeleteTask(event) {
      const button = event.target.closest('button');
      const listItem = button.closest('li');
       if (!listItem) return;
      const index = parseInt(listItem.dataset.index, 10); // Get index from dataset

       if (isNaN(index) || index < 0 || index >= todoTasks.length) {
           console.error("Invalid index for task deletion:", index);
           return;
       }

      // *** ADDED: Prevent deleting default tasks ***
      if (todoTasks[index].isDefault) {
          console.log("Cannot delete a default task.");
          alert("Default tasks cannot be deleted."); // Optional user feedback
          return;
      }

      // *** REMOVED: Confirmation dialog ***
      // if (confirm(`Delete task: "${todoTasks[index].text}"?`)) { ... }
      console.log(`Deleting task: "${todoTasks[index].text}"`);
      todoTasks.splice(index, 1);
      renderTodoList(); // Re-render after removing
      saveTasks();
  }

  // *** UPDATED: handleEnableTaskEdit checks for default tasks ***
  function handleEnableTaskEdit(event) {
      const taskNameSpan = event.target;
      if (!taskNameSpan || taskNameSpan.tagName !== 'SPAN') return;
      const listItem = taskNameSpan.closest('li');
       if (!listItem) return;
      const index = parseInt(listItem.dataset.index, 10); // Get index from dataset

      if (isNaN(index) || index < 0 || index >= todoTasks.length) return;

      // *** ADDED: Prevent editing default tasks ***
      if (todoTasks[index].isDefault) {
          console.log("Cannot edit a default task.");
          return;
      }

      if (listItem.querySelector('.edit-input')) return; // Already editing

      const currentText = todoTasks[index].text;
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'edit-input'; input.value = currentText;
      input.dataset.originalValue = currentText;

      input.addEventListener('blur', handleSaveTaskEdit);
      input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          else if (e.key === 'Escape') renderSingleTaskItem(listItem, index); // Cancel edit
      });

      taskNameSpan.replaceWith(input);
      input.focus(); input.select();
  }

 // *** UPDATED: handleSaveTaskEdit uses dataset.index ***
  function handleSaveTaskEdit(event) {
      const input = event.target;
      const listItem = input.closest('li');
       if (!listItem) return;
      const index = parseInt(listItem.dataset.index, 10); // Get index from dataset

       if (isNaN(index) || index < 0 || index >= todoTasks.length) {
           console.error("Invalid index for saving edit:", index);
           if(listItem && input.dataset.originalValue !== undefined) {
                 const taskData = todoTasks.find(task => task.text === input.dataset.originalValue && !task.isDefault) || {text: input.dataset.originalValue, completed: false};
                 renderSingleTaskItem(listItem, index, taskData); // Use find to be safer
           }
           return;
       }

      // *** ADDED: Double check against editing default task (shouldn't happen via UI) ***
       if (todoTasks[index].isDefault) {
           console.warn("Attempted to save edit for a default task. Reverting.");
            renderSingleTaskItem(listItem, index);
            return;
       }

      const newText = input.value.trim();
      if (newText && newText !== todoTasks[index].text) {
          todoTasks[index].text = newText;
          saveTasks();
          renderSingleTaskItem(listItem, index);
      } else {
           renderSingleTaskItem(listItem, index); // Re-render with original text if empty or unchanged
      }
  }

 // *** UPDATED: renderSingleTaskItem checks isDefault for actions ***
  function renderSingleTaskItem(listItemElement, index, taskDataOverride = null) {
       if (!listItemElement || isNaN(index) || index < 0) return;
       const task = taskDataOverride || todoTasks[index];
       if (!task) { console.warn("Task data missing for re-render index", index); return; }

       const taskContentDiv = listItemElement.querySelector('.task-content') || document.createElement('div');
       if (!listItemElement.querySelector('.task-content')) { // If creating content div
            taskContentDiv.className = 'task-content';
            listItemElement.innerHTML = ''; // Clear completely if recreating structure
            listItemElement.appendChild(taskContentDiv);
       } else { taskContentDiv.innerHTML = ''; } // Clear only content

       const checkbox = document.createElement('input');
       checkbox.type = 'checkbox'; checkbox.checked = !!task.completed;
       checkbox.title = task.completed ? "Mark as incomplete" : "Mark as complete";
       checkbox.addEventListener('change', handleToggleTaskCompletion);

       const taskNameSpan = document.createElement('span');
       taskNameSpan.textContent = task.text;
       if (task.completed) taskNameSpan.classList.add('completed');

       // Add edit listener and style cursor only for non-default tasks
       if (!task.isDefault) {
           taskNameSpan.addEventListener('dblclick', handleEnableTaskEdit);
            taskNameSpan.style.cursor = 'text';
       } else {
            taskNameSpan.style.cursor = 'default';
       }

       taskContentDiv.appendChild(checkbox);
       taskContentDiv.appendChild(taskNameSpan);

       // Remove existing actions div if present
       const existingActionsDiv = listItemElement.querySelector('.task-actions');
       if(existingActionsDiv) existingActionsDiv.remove();

       // Add actions div only if NOT a default task
       if (!task.isDefault) {
            const taskActionsDiv = document.createElement('div');
            taskActionsDiv.className = 'task-actions';
            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = `<i class="fas fa-trash"></i>`;
            deleteButton.classList.add('delete-btn');
            deleteButton.title = "Delete Task";
            deleteButton.addEventListener('click', handleDeleteTask);
            taskActionsDiv.appendChild(deleteButton);
            listItemElement.appendChild(taskActionsDiv);
       }

       listItemElement.dataset.index = index; // Ensure index is correct
  }

  // --- Skool Follow-ups Logic (Keep As Is) ---
  function loadFollowupsSection(dmFollowups, dmTags) {
    if (!followupsListEl) { console.error("Followups list element not found!"); return; }
    const followupEntries = Object.values(dmFollowups || {});
    if (followupEntries.length === 0) {
        followupsListEl.innerHTML = '<p class="no-tags">No Skool follow-ups scheduled.</p>';
        return;
    }
    followupsListEl.innerHTML = '';
    followupEntries.sort((a, b) => (a.remindAt || 0) - (b.remindAt || 0));
    followupEntries.forEach(followup => {
        if (!followup?.profileData?.username || !followup.profileKey || !followup.remindAt) {
            console.warn("Skipping rendering invalid follow-up entry:", followup); return;
        }
        const profile = followup.profileData; const profileKey = followup.profileKey;
        const tag = dmTags[profileKey]?.tag || 'None'; const notes = followup.notes;
        const remindDate = new Date(followup.remindAt); const isValidDate = !isNaN(remindDate.getTime());
        const followupDiv = document.createElement('div'); followupDiv.className = 'followup-item';
        const left = document.createElement('div');
        const imgSrc = profile.profilePicDataUrl || profile.profilePic || chrome.runtime.getURL("icons/icon.png");
        left.innerHTML = `<img src="${imgSrc}" alt="${profile.username}" /><div class="followup-info"><a href="${profile.profileLink || '#'}" target="_blank" class="followup-username-link" title="Open Skool Profile/DM (New Tab)">${profile.username}</a><span class="followup-tag">Tag: <span style="font-weight: bold; color: ${tag !== 'None' ? '#00796b' : '#777'};">${tag}</span></span><span class="followup-remind-time">Reminds: ${isValidDate ? remindDate.toLocaleString() : 'Invalid Date'}</span>${notes ? `<span class="followup-notes" title="Notes: ${notes}">Notes: <em>${notes}</em></span>` : ''}</div>`;
        const actions = document.createElement('div'); actions.className = 'followup-actions';
        const clearBtn = document.createElement('button'); clearBtn.textContent = 'Clear'; clearBtn.className = 'clear-btn'; clearBtn.title = "Clear this follow-up reminder";
        clearBtn.onclick = async () => await handleClearFollowUpPopup(profileKey);
        actions.appendChild(clearBtn); followupDiv.appendChild(left); followupDiv.appendChild(actions); followupsListEl.appendChild(followupDiv);
    });
}

  // --- Skool Tagged Profiles Logic (Keep As Is) ---
  function loadTagsSection(dmTags, tagOptions) {
    if (!taggedListEl) { console.error("Tagged list element not found!"); return; }
    const validDmTags = Object.entries(dmTags || {}).filter(([key, data]) => data?.username && data?.profileLink && data?.tag && !key.startsWith('dummy_'));
    const allPossibleTags = new Set([...tagOptions, ...validDmTags.map(([key, data]) => data.tag)]);
    const sortedTagsArray = Array.from(allPossibleTags).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (validDmTags.length === 0 && tagOptions.length === 0) {
        taggedListEl.innerHTML = '<p class="no-tags">No Skool profiles tagged yet.</p>'; return;
    }
    taggedListEl.innerHTML = '';
    const groupedByTag = {};
    validDmTags.forEach(([key, data]) => { const { username, profileLink, profilePic, profilePicDataUrl, tag } = data; if (!groupedByTag[tag]) groupedByTag[tag] = []; groupedByTag[tag].push({ key, username, profileLink, profilePic, profilePicDataUrl, tag }); });
    let displayedAnySections = false;
    for (const tagName of sortedTagsArray) {
        const profiles = groupedByTag[tagName] || [];
        if (profiles.length === 0 && !tagOptions.includes(tagName)) continue;
        displayedAnySections = true;
        const section = document.createElement('div'); section.className = 'tag-section';
        const title = document.createElement('div'); title.className = 'tag-title'; title.textContent = tagName; section.appendChild(title);
        if (profiles.length === 0) { const noProfilesText = document.createElement('p'); noProfilesText.textContent = 'No profiles with this tag.'; noProfilesText.className = 'no-items'; section.appendChild(noProfilesText); }
        else {
            profiles.sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
            profiles.forEach(profile => {
                const profileDiv = document.createElement('div'); profileDiv.className = 'profile';
                const left = document.createElement('div'); left.className = 'profile-left';
                const imgSrc = profile.profilePicDataUrl || profile.profilePic || chrome.runtime.getURL("icons/icon.png");
                left.innerHTML = `<img src="${imgSrc}" alt="${profile.username}" /><div class="info"><a href="${profile.profileLink || '#'}" target="_blank" title="Open Skool Profile/DM (New Tab)">${profile.username}</a></div>`;
                const actions = document.createElement('div'); actions.className = 'actions';
                const editBtn = document.createElement('button'); editBtn.textContent = 'Edit'; editBtn.className = 'edit-btn'; editBtn.onclick = () => displayEditOptions(actions, profile, sortedTagsArray);
                const deleteBtn = document.createElement('button'); deleteBtn.textContent = 'Delete'; deleteBtn.className = 'delete-btn'; deleteBtn.onclick = () => handleDeleteProfileTag(profile.key);
                actions.appendChild(editBtn); actions.appendChild(deleteBtn); profileDiv.appendChild(left); profileDiv.appendChild(actions); section.appendChild(profileDiv);
            });
        }
        taggedListEl.appendChild(section);
    }
     if (!displayedAnySections) taggedListEl.innerHTML = '<p class="no-tags">No Skool profiles tagged yet.</p>';
  }

  // --- Skool Tag Manager Logic (Keep As Is) ---
   function setupTagManager() {
      if (!manageBtn || !tagManager) { console.error("Tag Manager button or container not found."); return; }
      manageBtn.onclick = async () => {
          const isCurrentlyVisible = tagManager.style.display === 'block';
          tagManager.style.display = isCurrentlyVisible ? 'none' : 'block';
          if (tagManager.style.display === 'none') { manageBtn.textContent = 'Manage Skool Tags'; return; }
          manageBtn.textContent = 'Hide Tag Manager'; tagManager.innerHTML = '<h4>Manage Tag Labels</h4><p class="no-items">Loading...</p>';
          try {
               const freshData = await getStorageDataPromise(['tag_options', 'dm_tags']);
               currentTagOptions = freshData.tag_options || [...defaultTags]; currentDmTags = freshData.dm_tags || {};
               const allKnownTags = new Set([...currentTagOptions, ...Object.values(currentDmTags).map(d => d?.tag).filter(Boolean)]);
               const sortedTags = Array.from(allKnownTags).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
               tagManager.innerHTML = '<h4>Manage Tag Labels</h4>';
               if (sortedTags.length === 0) { const p = tagManager.appendChild(document.createElement('p')); p.textContent = 'No tags defined yet.'; p.className = 'no-tags'; }
               else {
                   sortedTags.forEach(t => { const div = document.createElement('div'); div.className = 'tag-manager-item'; const input = document.createElement('input'); input.type = 'text'; input.value = t; input.className = 'tag-manager-input'; input.dataset.originalName = t; const renameBtn = document.createElement('button'); renameBtn.textContent = 'Rename'; renameBtn.className = 'edit-btn'; renameBtn.onclick = () => handleRenameTag(input, input.dataset.originalName, sortedTags); const deleteBtn = document.createElement('button'); deleteBtn.textContent = 'Delete'; deleteBtn.className = 'delete-btn'; deleteBtn.title = `Delete the tag label "${t}". Profiles using it will lose this tag.`; deleteBtn.onclick = () => { if (confirm(`Delete the tag label "${t}"?\n\nProfiles currently using this tag will lose this tag value (they won't be deleted).`)) { handleDeleteTagLabel(t); } }; div.appendChild(input); div.appendChild(renameBtn); div.appendChild(deleteBtn); tagManager.appendChild(div); });
               }
               tagManager.appendChild(document.createElement('hr')); const addDiv = document.createElement('div'); addDiv.className = 'tag-manager-add'; const addInput = document.createElement('input'); addInput.type = 'text'; addInput.placeholder = 'New tag name...'; addInput.className = 'tag-manager-input'; const addBtn = document.createElement('button'); addBtn.textContent = 'Add Tag'; addBtn.className = 'save-btn'; addBtn.onclick = () => handleAddTag(addInput, sortedTags); addInput.addEventListener('keypress', (event) => { if (event.key === 'Enter') { event.preventDefault(); addBtn.click(); } }); addDiv.appendChild(addInput); addDiv.appendChild(addBtn); tagManager.appendChild(addDiv);
          } catch (error) { console.error("Error loading tags for manager:", error); tagManager.innerHTML = '<h4>Manage Tag Labels</h4><p class="no-tags">Error loading tag data.</p>'; }
      };
  }

  // --- Action Handlers (Keep As Is, except for delete confirmation removal which was handled in Todo section) ---
  // Edit Tag Display
   function displayEditOptions(actionsContainer, profile, tagsArray) {
      if (!actionsContainer || !profile || !tagsArray) return; actionsContainer.innerHTML = '';
      const selectContainer = document.createElement('div'); selectContainer.style.cssText = 'display: flex; gap: 5px; align-items: center;';
      const tagSelect = document.createElement('select'); tagSelect.className = 'tag-dropdown';
      tagsArray.forEach(t => { const option = document.createElement('option'); option.value = t; option.textContent = t; if (t === profile.tag) option.selected = true; tagSelect.appendChild(option); });
      const saveBtn = document.createElement('button'); saveBtn.textContent = 'Save'; saveBtn.className = 'save-btn';
      saveBtn.onclick = async () => { const selectedValue = tagSelect.value; selectContainer.innerHTML = '<p style="font-size: 11px; margin: 5px;">Saving...</p>'; await handleUpdateProfileTag(profile.key, selectedValue); };
      const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Cancel'; cancelBtn.className = 'cancel-btn'; cancelBtn.onclick = () => { loadTagsSection(currentDmTags, currentTagOptions); };
      selectContainer.appendChild(tagSelect); selectContainer.appendChild(saveBtn); selectContainer.appendChild(cancelBtn); actionsContainer.appendChild(selectContainer);
  }
  // Clear Followup
   async function handleClearFollowUpPopup(profileKey) {
      if (!profileKey) return; console.log(`Attempting to clear follow-up for ${profileKey}`); try { let { dm_followups } = await getStorageDataPromise(['dm_followups']); dm_followups = dm_followups || {}; if (dm_followups[profileKey]) { delete dm_followups[profileKey]; await setStorageDataPromise({ dm_followups }); console.log(`Popup: Cleared follow-up storage for ${profileKey}`); chrome.runtime.sendMessage({ action: "clearAlarm", name: profileKey }, response => { if (chrome.runtime.lastError) console.error("Popup: Error sending clearAlarm msg:", chrome.runtime.lastError.message); else console.log("Popup: Alarm clear request sent.", response); loadFollowupsSection(dm_followups, currentDmTags); }); } else { console.log(`Popup: No follow-up found in storage for key ${profileKey} to clear.`); loadFollowupsSection(dm_followups, currentDmTags); } } catch (error) { console.error("Popup: Error clearing follow-up:", error); alert("Error clearing follow-up. Please try again."); loadFollowupsSection(currentDmTags.dm_followups || {}, currentDmTags); }
  }
  // Update Profile Tag
   async function handleUpdateProfileTag(profileKey, newTag) { console.log(`Updating tag for ${profileKey} to ${newTag}`); try { let { dm_tags, tag_options } = await getStorageDataPromise(['dm_tags', 'tag_options']); dm_tags = dm_tags || {}; tag_options = tag_options || [...defaultTags]; if (!dm_tags[profileKey]) { console.warn(`UpdateProfileTag: No profile found for key ${profileKey}`); loadTagsSection(dm_tags, tag_options); return; } dm_tags[profileKey].tag = newTag; let optionsChanged = false; const optionsLower = tag_options.map(o => o.toLowerCase()); if (!optionsLower.includes(newTag.toLowerCase())) { tag_options.push(newTag); tag_options.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); optionsChanged = true; } currentDmTags = dm_tags; currentTagOptions = tag_options; const dataToSet = optionsChanged ? { dm_tags, tag_options } : { dm_tags }; await setStorageDataPromise(dataToSet); console.log("Tags/Options updated successfully."); loadTagsSection(currentDmTags, currentTagOptions); if (tagManager.style.display === 'block') setupTagManager(); } catch (error) { console.error("Error updating profile tag:", error); alert("Error updating tag."); initializeDashboard(); } }
  // Delete Profile Entry
   async function handleDeleteProfileTag(profileKey) { console.log(`Deleting tagged profile entry ${profileKey}`); if (!confirm(`Are you sure you want to remove the tagged profile entry for this user entirely?`)) return; try { let { dm_tags } = await getStorageDataPromise(['dm_tags']); dm_tags = dm_tags || {}; if (dm_tags[profileKey]) { delete dm_tags[profileKey]; currentDmTags = dm_tags; await setStorageDataPromise({ dm_tags }); console.log("Profile entry deleted successfully."); loadTagsSection(currentDmTags, currentTagOptions); const { dm_followups } = await getStorageDataPromise(['dm_followups']); loadFollowupsSection(dm_followups || {}, currentDmTags); } else { console.log(`DeleteProfileTag: No entry found for key ${profileKey}.`); loadTagsSection(currentDmTags, currentTagOptions); } } catch (error) { console.error("Error deleting profile entry:", error); alert("Error deleting profile entry."); initializeDashboard(); } }
  // Rename Tag Label
   async function handleRenameTag(inputElement, oldName, existingTags) { const newName = inputElement.value.trim(); if (!newName) { alert("Tag name cannot be empty."); inputElement.value = oldName; return; } if (newName.toLowerCase() === oldName.toLowerCase() && newName !== oldName) {} else if (newName.toLowerCase() === oldName.toLowerCase()) { inputElement.value = oldName; return; } if (existingTags.some(et => et.toLowerCase() === newName.toLowerCase() && et.toLowerCase() !== oldName.toLowerCase())) { alert(`Tag "${newName}" already exists (case-insensitive).`); inputElement.value = oldName; return; } console.log(`Renaming tag "${oldName}" to "${newName}"`); try { let { dm_tags, tag_options } = await getStorageDataPromise(['dm_tags', 'tag_options']); dm_tags = dm_tags || {}; tag_options = tag_options || [...defaultTags]; let changed = false; Object.keys(dm_tags).forEach(key => { if (dm_tags[key].tag?.toLowerCase() === oldName.toLowerCase()) { dm_tags[key].tag = newName; changed = true; } }); const oldIndex = tag_options.findIndex(opt => opt.toLowerCase() === oldName.toLowerCase()); const newIndex = tag_options.findIndex(opt => opt.toLowerCase() === newName.toLowerCase()); if (oldIndex > -1) { if (newIndex === -1 || newIndex === oldIndex) tag_options[oldIndex] = newName; else tag_options.splice(oldIndex, 1); changed = true; } else if (changed && newIndex === -1) { tag_options.push(newName); changed = true; } if (changed) { tag_options.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); currentDmTags = dm_tags; currentTagOptions = tag_options; await setStorageDataPromise({ dm_tags, tag_options }); console.log("Tag renamed successfully in storage."); loadTagsSection(currentDmTags, currentTagOptions); setupTagManager(); } else { console.log("RenameTag: No changes needed."); inputElement.value = oldName; } } catch (error) { console.error("Error renaming tag:", error); alert("Error renaming tag."); initializeDashboard(); } }
  // Delete Tag Label
   async function handleDeleteTagLabel(tagName) { console.log(`Deleting tag label "${tagName}"`); try { let { dm_tags, tag_options } = await getStorageDataPromise(['dm_tags', 'tag_options']); dm_tags = dm_tags || {}; tag_options = tag_options || [...defaultTags]; let changed = false; Object.keys(dm_tags).forEach(key => { if (dm_tags[key].tag?.toLowerCase() === tagName.toLowerCase()) { delete dm_tags[key].tag; changed = true; } }); const initialLength = tag_options.length; tag_options = tag_options.filter(opt => opt.toLowerCase() !== tagName.toLowerCase()); if (tag_options.length < initialLength) changed = true; if (changed) { currentDmTags = dm_tags; currentTagOptions = tag_options; await setStorageDataPromise({ dm_tags, tag_options }); console.log("Tag label deleted successfully from storage. Profiles untagged."); loadTagsSection(currentDmTags, currentTagOptions); setupTagManager(); } else console.log(`DeleteTagLabel: Tag "${tagName}" not found.`); } catch(error) { console.error("Error deleting tag label:", error); alert("Error deleting tag label."); initializeDashboard(); } }
  // Add New Tag Label
   async function handleAddTag(inputElement, existingTags) { const newTagName = inputElement.value.trim(); if (!newTagName) return; if (existingTags.some(et => et.toLowerCase() === newTagName.toLowerCase())) { alert(`Tag "${newTagName}" already exists (case-insensitive).`); return; } console.log(`Adding new tag label "${newTagName}"`); try { let { tag_options } = await getStorageDataPromise(['tag_options']); tag_options = tag_options || [...defaultTags]; if (!tag_options.some(opt => opt.toLowerCase() === newTagName.toLowerCase())) { tag_options.push(newTagName); tag_options.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); currentTagOptions = tag_options; await setStorageDataPromise({ tag_options }); console.log("New tag label added successfully."); loadTagsSection(currentDmTags, currentTagOptions); setupTagManager(); inputElement.value = ''; } else { console.log(`AddTagLabel: Tag "${newTagName}" already exists in storage.`); alert(`Tag "${newTagName}" already exists (case-insensitive).`); setupTagManager(); } } catch(error) { console.error("Error adding new tag label:", error); alert("Error adding tag label."); initializeDashboard(); } }

  // --- Event Listeners ---
  if (todoForm) todoForm.addEventListener('submit', handleAddTask);
  else console.error("To-Do form element not found!");

}); // End DOMContentLoaded
// --- END OF FILE popup.js ---