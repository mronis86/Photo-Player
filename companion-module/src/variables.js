module.exports = function (self) {
	self.setVariableDefinitions([
		{ variableId: 'live_index', name: 'Live cue index' },
		{ variableId: 'next_index', name: 'Next cue index' },
		{ variableId: 'is_live', name: 'Is live (Yes/No)' },
		{ variableId: 'playout_connected', name: 'Playout connected (Yes/No)' },
		{ variableId: 'cue_count', name: 'Cue count' },
		{ variableId: 'live_cue_name', name: 'Live cue name' },
		{ variableId: 'next_cue_name', name: 'Next cue name' },
	])
}
