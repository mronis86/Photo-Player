const { combineRgb } = require('@companion-module/base')

module.exports = async function (self) {
	const cueChoices = (self.cues || []).map((c, i) => {
		const label = c.buttonLabel || c.displayName || c.captionTitle || c.name || `Cue ${i}`
		return { id: i, label: `${i}: ${label}` }
	})
	if (cueChoices.length === 0) {
		for (let i = 0; i <= 20; i++) {
			cueChoices.push({ id: i, label: `Cue ${i}` })
		}
	}

	self.setFeedbackDefinitions({
		live_cue_is: {
			name: 'Live cue is',
			type: 'boolean',
			label: 'Live cue is (index)',
			defaultStyle: {
				bgcolor: combineRgb(0, 150, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [
				{
					id: 'cueIndex',
					type: 'dropdown',
					label: 'Cue index',
					default: 0,
					choices: cueChoices,
				},
			],
			callback: (feedback) => {
				const idx = Number(feedback.options?.cueIndex)
				const liveIdx = Number(self.state?.liveIndex)
				if (!Number.isFinite(idx)) return false
				// When program cleared, liveIndex is -1 so no cue is live
				return Number.isFinite(liveIdx) && liveIdx >= 0 && liveIdx === idx
			},
		},
		next_cue_is: {
			name: 'Next cue is',
			type: 'boolean',
			label: 'Next cue is (index)',
			defaultStyle: {
				bgcolor: combineRgb(50, 100, 200),
				color: combineRgb(255, 255, 255),
			},
			options: [
				{
					id: 'cueIndex',
					type: 'dropdown',
					label: 'Cue index',
					default: 0,
					choices: cueChoices,
				},
			],
			callback: (feedback) => {
				const idx = Number(feedback.options?.cueIndex)
				const nextIdx = Number(self.state?.nextIndex)
				if (!Number.isFinite(idx)) return false
				return Number.isFinite(nextIdx) && nextIdx >= 0 && nextIdx === idx
			},
		},
		playout_connected: {
			name: 'Playout connected',
			type: 'boolean',
			label: 'Playout connected',
			defaultStyle: {
				bgcolor: combineRgb(0, 120, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.state?.playoutConnected === true,
		},
		is_live: {
			name: 'Is live',
			type: 'boolean',
			label: 'Is live (program has a cue)',
			defaultStyle: {
				bgcolor: combineRgb(180, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			// Only true when there is a program cue (liveIndex >= 0). Ignore isLive so stale state doesn’t keep Take red.
			callback: () => {
				const liveIdx = Number(self.state?.liveIndex)
				return Number.isFinite(liveIdx) && liveIdx >= 0
			},
		},
		button_text_playout_status: {
			name: 'Button text: output status',
			type: 'advanced',
			label: 'Button text: OUTPUT CONNECTED / DISCONNECTED',
			options: [],
			callback: () => {
				const connected = self.state?.playoutConnected === true
				return { text: connected ? 'OUTPUT\nCONNECTED' : 'OUTPUT\nDISCONNECTED' }
			},
		},
		button_text_cue_name: {
			name: 'Button text: cue name',
			type: 'advanced',
			label: 'Button text from cue (index) – updates when cue name changes',
			options: [
				{
					id: 'cueIndex',
					type: 'dropdown',
					label: 'Cue index',
					default: 0,
					choices: cueChoices,
				},
			],
			callback: (feedback) => {
				const idx = Number(feedback.options?.cueIndex)
				if (!Number.isFinite(idx)) return {}
				const cues = self.cues || []
				const c = cues[idx]
				const label = c ? (c.buttonLabel || c.displayName || c.captionTitle || c.name || 'Untitled') : 'Untitled'
				const cueNum = idx + 1
				return { text: `${cueNum}: ${label}` }
			},
		},
	})
}
