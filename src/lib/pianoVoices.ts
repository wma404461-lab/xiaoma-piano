export const PIANO_VOICES = [
 {id:'yamaha',name:'Generated tone · Warm',detail:'Original additive-synthesis practice tone',source:''},
 {id:'steinway',name:'Generated tone · Bright',detail:'Original additive-synthesis practice tone',source:''},
 {id:'fluid',name:'Generated tone · Soft',detail:'Original additive-synthesis practice tone',source:''},
] as const;
export type PianoVoice = typeof PIANO_VOICES[number]['id'];
