void BreakPoint::Install()
{
    breakPoint_ = 0xCC;
    context.Rip -= 1;
}
