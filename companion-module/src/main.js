const { InstanceBase, runEntrypoint, InstanceStatus, combineRgb } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

class ImageMotionPlaybackInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.state = null
		this.cues = []
		this.pollInterval = null
	}

	async init(config) {
		this.config = config
		const code = this.getCode()
		const apiUrl = this.getApiUrl()
		this.log('info', `Init code=${code || '(none)'} apiUrl=${apiUrl ? apiUrl.slice(0, 40) + '…' : '(none)'}`)
		this.updateStatus(InstanceStatus.Connecting)
		await this.fetchState()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.updateVariableValues()
		this.checkAllFeedbacks()
		this.startPolling()
		this.updateStatus(InstanceStatus.Ok)
	}

	async destroy() {
		if (this.pollInterval) clearInterval(this.pollInterval)
	}

	async configUpdated(config) {
		this.config = config
		this.log('info', `Config updated code=${this.getCode()}`)
		this.updateStatus(InstanceStatus.Connecting)
		await this.fetchState()
		this.startPolling()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.updateVariableValues()
		this.checkAllFeedbacks()
		this.updateStatus(InstanceStatus.Ok)
	}

	getApiUrl() {
		let url = (this.config?.apiUrl || '').trim().replace(/\/+$/, '')
		if (!url) return ''
		if (!/^https?:\/\//i.test(url)) {
			url = 'https://' + url
		}
		return url
	}

	getCode() {
		return String(this.config?.connectionCode || '').trim().toUpperCase()
	}

	async fetch(path, options = {}) {
		const baseUrl = this.getApiUrl()
		const code = this.getCode()
		if (!baseUrl || !code) {
			throw new Error('Set API Base URL and Connection Code in config')
		}
		const sep = path.includes('?') ? '&' : '?'
		const fullUrl = path.startsWith('http') ? path : `${baseUrl}${path}${sep}code=${encodeURIComponent(code)}`
		try {
			const res = await fetch(fullUrl, {
				...options,
				headers: { 'Content-Type': 'application/json', ...options.headers },
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const text = await res.text()
			return text ? JSON.parse(text) : null
		} catch (err) {
			this.log('error', `API request failed: ${err.message}`)
			throw err
		}
	}

	async fetchState() {
		const code = this.getCode()
		if (!code) {
			this.state = null
			this.cues = []
			return
		}
		try {
			this.state = await this.fetch('/state')
			this.cues = Array.isArray(this.state?.cues) ? this.state.cues : []
			const n = this.cues.length
			this.log('info', `State fetched code=${code} cues=${n}`)
			if (n === 0) {
				this.log('info', `Cues=0: open controller in browser with same code (${code}) and a project that has cues, then wait a few seconds`)
			}
		} catch (err) {
			this.state = null
			this.cues = []
			this.log('warn', `fetchState failed: ${err.message}`)
		}
	}

	startPolling() {
		if (this.pollInterval) clearInterval(this.pollInterval)
		this.pollInterval = null
		const seconds = Math.max(5, Math.min(120, parseInt(this.config?.pollIntervalSeconds, 10) || 10))
		const ms = seconds * 1000
		const self = this
		this.pollInterval = setInterval(async () => {
			if (!self.getCode()) return
			await self.fetchState()
			self.updateActions()
			self.updateFeedbacks()
			self.updatePresets()
			self.updateVariableDefinitions()
			self.updateVariableValues()
			self.checkAllFeedbacks()
		}, ms)
	}

	async apiGet(path) {
		const baseUrl = this.getApiUrl()
		const code = this.getCode()
		if (!baseUrl || !code) throw new Error('Set API Base URL and Connection Code')
		const sep = path.includes('?') ? '&' : '?'
		const url = `${baseUrl}${path}${sep}code=${encodeURIComponent(code)}`
		const res = await fetch(url)
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		return res.json().catch(() => ({}))
	}

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'apiUrl',
				label: 'API Base URL',
				width: 12,
				default: '',
				tooltip: 'Railway Companion API URL (e.g. https://your-app.up.railway.app). No trailing slash.',
			},
			{
				type: 'textinput',
				id: 'connectionCode',
				label: 'Connection Code',
				width: 6,
				default: '',
				tooltip: '6-character code from the controller (same as playout window).',
			},
			{
				type: 'number',
				id: 'pollIntervalSeconds',
				label: 'Poll interval (seconds)',
				width: 6,
				default: 10,
				min: 5,
				max: 120,
				tooltip: 'How often to fetch state for feedback (5–120).',
			},
		]
	}

	checkAllFeedbacks() {
		this.checkFeedbacks(
			'live_cue_is',
			'next_cue_is',
			'playout_connected',
			'is_live',
			'button_text_cue_name'
		)
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updatePresets() {
		const presets = {}
		const cues = this.cues || []
		const liveIndex = this.state?.liveIndex ?? -1
		const nextIndex = this.state?.nextIndex ?? 0

		// Take
		presets.take = {
			type: 'button',
			category: 'Transport',
			name: 'Take',
			style: {
				text: 'TAKE',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 120, 0),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'take', options: {} }], up: [] }],
		}

		// Next
		presets.next = {
			type: 'button',
			category: 'Transport',
			name: 'Next',
			style: {
				text: 'NEXT',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(50, 80, 140),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'next', options: {} }], up: [] }],
		}

		// Prev
		presets.prev = {
			type: 'button',
			category: 'Transport',
			name: 'Prev',
			style: {
				text: 'PREV',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(50, 80, 140),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'prev', options: {} }], up: [] }],
		}

		// Clear
		presets.clear = {
			type: 'button',
			category: 'Transport',
			name: 'Clear',
			style: {
				text: 'CLEAR',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(120, 0, 0),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'clear', options: {} }], up: [] }],
		}

		// Fade to black
		presets.fade_black = {
			type: 'button',
			category: 'Transport',
			name: 'Fade to black',
			style: {
				text: 'FADE',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(60, 60, 60),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'fade', options: { fadeTo: 'black' } }], up: [] }],
		}

		// Fade to transparent
		presets.fade_transparent = {
			type: 'button',
			category: 'Transport',
			name: 'Fade to transparent',
			style: {
				text: 'FADE OUT',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(60, 60, 80),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'fade', options: { fadeTo: 'transparent' } }], up: [] }],
		}

		// Cues category: always show. Placeholder when no cues; otherwise one preset per project cue.
		if (cues.length === 0) {
			presets.cues_placeholder = {
				type: 'button',
				category: 'Cues',
				name: 'No cues — open controller with same code + project',
				style: {
					text: 'No cues\n(same code\n+ project)',
					size: 'auto',
					color: combineRgb(180, 180, 180),
					bgcolor: combineRgb(50, 50, 50),
				},
				feedbacks: [],
				steps: [{ down: [], up: [] }],
			}
		} else {
			for (let i = 0; i < cues.length; i++) {
				const cue = cues[i]
				const fileName = cue.displayName || cue.captionTitle || cue.name || 'Untitled'
				const cueNum = i + 1
				const buttonText = `${cueNum}: ${fileName}`
				presets[`cue_${i}`] = {
					type: 'button',
					category: 'Cues',
					name: `Go to cue ${cueNum}: ${fileName}`,
					style: {
						text: buttonText,
						size: 'auto',
						color: combineRgb(255, 255, 255),
						bgcolor: combineRgb(40, 40, 40),
					},
					feedbacks: [
						{
							feedbackId: 'live_cue_is',
							options: { cueIndex: i },
							style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
						},
						{
							feedbackId: 'next_cue_is',
							options: { cueIndex: i },
							style: { bgcolor: combineRgb(50, 100, 200), color: combineRgb(255, 255, 255) },
						},
					],
					steps: [{ down: [{ actionId: 'cue', options: { cueIndex: i } }], up: [] }],
				}
			}
		}

		this.log('info', `Presets updated: Transport + Cues(${cues.length})`)
		this.setPresetDefinitions(presets)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}

	updateVariableValues() {
		const s = this.state
		const liveIdx = s?.liveIndex ?? -1
		const nextIdx = s?.nextIndex ?? 0
		const cues = this.cues || []
		const liveCue = cues[liveIdx]
		const nextCue = cues[nextIdx]
		this.setVariableValues({
			live_index: liveIdx >= 0 ? String(liveIdx) : '—',
			next_index: String(nextIdx),
			is_live: s?.isLive === true ? 'Yes' : 'No',
			playout_connected: s?.playoutConnected === true ? 'Yes' : 'No',
			cue_count: String(cues.length),
			live_cue_name: liveCue?.displayName || liveCue?.captionTitle || liveCue?.name || '—',
			next_cue_name: nextCue?.displayName || nextCue?.captionTitle || nextCue?.name || '—',
		})
	}
}

runEntrypoint(ImageMotionPlaybackInstance, UpgradeScripts)
