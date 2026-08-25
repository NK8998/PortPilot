void BreakPoint::Install(TargetArchitecture architecture)
{
    auto instruction = BreakpointInstructionFor(architecture);
    context.ProgramCounter -= instruction.size();
}
