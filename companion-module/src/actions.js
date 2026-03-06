module.exports = function (self) {
	const cueChoices = (self.cues || []).map((c, i) => {
		const label = c.displayName || c.captionTitle || c.name || `Cue ${i}`
		return { id: i, label: `${i}: ${label}` }
	})
	if (cueChoices.length === 0) {
		for (let i = 0; i <= 20; i++) {
			cueChoices.push({ id: i, label: `Cue ${i}` })
		}
	}

	self.setActionDefinitions({
		take: {
			name: 'Take',
			options: [],
			callback: async () => {
				try {
					await self.apiGet('/take')
					self.log('info', 'Take')
					await self.fetchState()
					self.updateVariableValues()
					self.checkAllFeedbacks()
				} catch (err) {
					self.log('error', `Take failed: ${err.message}`)
				}
			},
		},
		next: {
			name: 'Next',
			options: [],
			callback: async () => {
				try {
					await self.apiGet('/next')
					self.log('info', 'Next')
					await self.fetchState()
					self.updateVariableValues()
					self.checkAllFeedbacks()
				} catch (err) {
					self.log('error', `Next failed: ${err.message}`)
				}
			},
		},
		prev: {
			name: 'Prev',
			options: [],
			callback: async () => {
				try {
					await self.apiGet('/prev')
					self.log('info', 'Prev')
					await self.fetchState()
					self.updateVariableValues()
					self.checkAllFeedbacks()
				} catch (err) {
					self.log('error', `Prev failed: ${err.message}`)
				}
			},
		},
		cue: {
			name: 'Go to cue',
			options: [
				{
					id: 'cueIndex',
					type: 'dropdown',
					label: 'Cue (index)',
					default: 0,
					choices: cueChoices,
				},
			],
			callback: async (event) => {
				const index = Number(event.options.cueIndex)
				if (!Number.isFinite(index) || index < 0) {
					self.log('warn', 'Go to cue: invalid index')
					return
				}
				try {
					await self.apiGet(`/cue/${index}`)
					self.log('info', `Go to cue ${index}`)
					await self.fetchState()
					self.updateVariableValues()
					self.checkAllFeedbacks()
				} catch (err) {
					self.log('error', `Go to cue failed: ${err.message}`)
				}
			},
		},
		clear: {
			name: 'Clear',
			options: [],
			callback: async () => {
				try {
					await self.apiGet('/clear')
					self.log('info', 'Clear')
					await self.fetchState()
					self.updateVariableValues()
					self.checkAllFeedbacks()
				} catch (err) {
					self.log('error', `Clear failed: ${err.message}`)
				}
			},
		},
		fade: {
			name: 'Fade',
			options: [
				{
					id: 'fadeTo',
					type: 'dropdown',
					label: 'Fade to',
					default: 'black',
					choices: [
						{ id: 'black', label: 'Black' },
						{ id: 'transparent', label: 'Transparent' },
					],
				},
			],
			callback: async (event) => {
				const to = event.options.fadeTo === 'transparent' ? 'transparent' : 'black'
				try {
					await self.apiGet(`/fade?to=${to}`)
					self.log('info', `Fade to ${to}`)
					await self.fetchState()
					self.updateVariableValues()
					self.checkAllFeedbacks()
				} catch (err) {
					self.log('error', `Fade failed: ${err.message}`)
				}
			},
		},
	})
}
