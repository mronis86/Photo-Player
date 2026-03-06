const { combineRgb } = require('@companion-module/base')

module.exports = async function (self) {
	const cueChoices = (self.cues || []).map((c, i) => {
		const label = c.displayName || c.captionTitle || c.name || `Cue ${i}`
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
				return Number.isFinite(idx) && (self.state?.liveIndex ?? -1) === idx
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
				return Number.isFinite(idx) && (self.state?.nextIndex ?? 0) === idx
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
				bgcolor: combineRgb(200, 80, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.state?.isLive === true,
		},
		button_text_cue_name: {
			name: 'Button text: cue name',
			type: 'advanced',
			label: 'Button text from cue (index)',
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
				const text = c ? (c.displayName || c.captionTitle || c.name || `#${idx}`) : `#${idx}`
				return { text }
			},
		},
	})
}
